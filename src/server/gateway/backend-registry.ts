import { gatewayVersion } from "../../lib/gateway-version";
import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { getDb } from "../db/client";
import { backendServers, type BackendServer } from "../db/schema";
import { emitGatewayEvent } from "../events/bus";
import { backendFetch, validateBackendUrl } from "./egress";
import { relayInventoryChange } from "./inventory-notifications";
import { stdioLaunch } from "./stdio-launch";
import { resolveBackendValues } from "./backend-secrets";

const RECONNECT_INITIAL_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

export type BackendStatus = "connected" | "connecting" | "disconnected" | "error";

class BackendConfigurationError extends Error {}

export class BackendConnection {
  readonly id: string;
  readonly key: string;
  row: BackendServer;
  client: Client | null = null;
  status: BackendStatus = "disconnected";
  lastError: string | null = null;
  private transport: Transport | null = null;
  private reconnectDelay = RECONNECT_INITIAL_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private connecting = false;
  private pendingClient: Client | null = null;
  private closing: Promise<void> | null = null;

  get pid(): number | null {
    return this.transport instanceof StdioClientTransport ? this.transport.pid : null;
  }

  constructor(row: BackendServer, private readonly ownsBackend = () => true) {
    this.id = row.id;
    this.key = row.key;
    this.row = row;
  }

  private setStatus(status: BackendStatus, lastError: string | null = null) {
    this.status = status;
    this.lastError = lastError;
    if (!this.ownsBackend()) return;
    void getDb()
      .update(backendServers)
      .set({
        status,
        lastError,
        lastConnectedAt: status === "connected" ? new Date() : this.row.lastConnectedAt,
        updatedAt: new Date(),
      })
      .where(eq(backendServers.id, this.id))
      .catch(() => {});
    emitGatewayEvent({
      type: "server.status_changed",
      serverId: this.id,
      serverKey: this.key,
      status,
      lastError,
    });
  }

  createTransport(): Transport {
    switch (this.row.connectionType) {
      case "stdio": {
        if (!this.row.command) throw new Error("stdio server missing command");
        const transport = new StdioClientTransport({
          ...stdioLaunch(this.row.key, this.row.command, this.row.args ?? []),
          env: resolveBackendValues(this.row.env),
        });
        return transport;
      }
      case "http":
      case "sse": {
        if (!this.row.url) throw new Error("Remote backend URL is missing");
        const url = validateBackendUrl(this.row.url);
        const options = {
          fetch: backendFetch(url.origin),
          requestInit: this.row.headers ? { headers: resolveBackendValues(this.row.headers) } : undefined,
        };
        return this.row.connectionType === "http"
          ? new StreamableHTTPClientTransport(url, options)
          : new SSEClientTransport(url, options);
      }
      default:
        throw new Error(`unknown connection type: ${this.row.connectionType}`);
    }
  }

  async connect() {
    if (this.closed || this.connecting) return;
    this.connecting = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.setStatus("connecting");
    let pendingTransport: Transport | null = null;
    try {
      // Shared backend connections cannot identify the client that originated a callback.
      const client = new Client({ name: "mcp-gateway", version: gatewayVersion });
      const notify = (kind: "tools" | "resources" | "prompts") => {
        if (this.client === client && this.ownsBackend()) return relayInventoryChange(this.id, kind);
      };
      client.setNotificationHandler(ToolListChangedNotificationSchema, () => notify("tools"));
      client.setNotificationHandler(ResourceListChangedNotificationSchema, () => notify("resources"));
      client.setNotificationHandler(PromptListChangedNotificationSchema, () => notify("prompts"));
      let transport: Transport;
      try {
        transport = this.createTransport();
      } catch (error) {
        throw new BackendConfigurationError(error instanceof Error ? error.message : "Backend configuration is invalid");
      }
      this.pendingClient = client;
      pendingTransport = transport;
      client.onclose = () => {
        if (this.closed || this.client !== client) return;
        this.client = null;
        this.transport = null;
        this.setStatus("disconnected", "backend connection closed");
        this.scheduleReconnect();
      };
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          client.connect(transport, { timeout: 10_000 }),
          new Promise<never>((_, reject) => {
            deadline = setTimeout(() => reject(new Error("Backend connection timed out")), 12_000);
          }),
        ]);
      } finally {
        if (deadline !== undefined) clearTimeout(deadline);
      }
      if (this.closed) {
        await client.close().catch(() => {});
        return;
      }
      this.client = client;
      this.transport = transport;
      this.reconnectDelay = RECONNECT_INITIAL_MS;
      this.setStatus("connected");
    } catch (err) {
      this.client = null;
      this.transport = null;
      await this.pendingClient?.close().catch(() => {});
      await pendingTransport?.close().catch(() => {});
      if (!this.closed) {
        this.setStatus("error", err instanceof BackendConfigurationError ? err.message : "Backend connection failed");
        if (!(err instanceof BackendConfigurationError)) this.scheduleReconnect();
      }
    } finally {
      this.pendingClient = null;
      this.connecting = false;
    }
  }

  private scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, Math.floor(this.reconnectDelay * randomInt(800, 1001) / 1000));
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const client = this.client ?? this.pendingClient;
    this.client = null;
    this.transport = null;
    this.closing = (async () => {
      await client?.close().catch(() => {});
      this.setStatus("disconnected");
    })();
    return this.closing;
  }
}

declare global {
  var __gatewayConnections: Map<string, BackendConnection> | undefined;
  var __gatewayBackendClosing: Map<string, Promise<void>> | undefined;
  var __gatewayBackendRegistryBootPromise: Promise<void> | undefined;
}

// Next.js instrumentation and route bundles can load separate copies of this module.
const connections = (globalThis.__gatewayConnections ??= new Map());
const closingBackends = (globalThis.__gatewayBackendClosing ??= new Map());

async function drainBackend(id: string, connection?: BackendConnection): Promise<void> {
  const prior = closingBackends.get(id);
  if (!prior && !connection) return;
  const finished = Promise.allSettled([prior, connection?.close()]).then(() => {});
  closingBackends.set(id, finished);
  await finished;
  if (closingBackends.get(id) === finished) closingBackends.delete(id);
}


export async function bootstrapBackendRegistry() {
  if (globalThis.__gatewayBackendRegistryBootPromise) return globalThis.__gatewayBackendRegistryBootPromise;

  globalThis.__gatewayBackendRegistryBootPromise = (async () => {
    const rows = await getDb().select().from(backendServers).where(eq(backendServers.enabled, true));
    await Promise.all(rows.map((row) => addOrReplaceConnection(row)));
  })();

  return globalThis.__gatewayBackendRegistryBootPromise;
}

export async function addOrReplaceConnection(row: BackendServer) {
  const existing = connections.get(row.id);
  const conn: BackendConnection = new BackendConnection(row, () => connections.get(row.id) === conn);
  connections.set(row.id, conn);
  await drainBackend(row.id, existing);
  if (connections.get(row.id) !== conn) return conn;
  if (row.enabled) await conn.connect();
  else await conn.close();
  return conn;
}

export async function removeConnection(id: string) {
  const existing = connections.get(id);
  connections.delete(id);
  await drainBackend(id, existing);
}

export function getConnection(id: string): BackendConnection | undefined {
  return connections.get(id);
}

export function getConnectionByKey(key: string): BackendConnection | undefined {
  for (const conn of connections.values()) {
    if (conn.key === key) return conn;
  }
  return undefined;
}

export function getAllConnections(): BackendConnection[] {
  return Array.from(connections.values());
}


export async function closeAllBackends(): Promise<void> {
  await Promise.allSettled([...connections.keys()].map(removeConnection));
}

import { eq } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { db } from "../db/client";
import { backendServers, type BackendServer } from "../db/schema";
import { emitGatewayEvent } from "../events/bus";
import { BUILTIN_GATEWAY_TOOLS_SERVER_KEY } from "./seed-builtin-server";

const RECONNECT_INITIAL_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

export type BackendStatus = "connected" | "connecting" | "disconnected" | "error";

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

  get pid(): number | null {
    return this.transport instanceof StdioClientTransport ? this.transport.pid : null;
  }

  constructor(row: BackendServer) {
    this.id = row.id;
    this.key = row.key;
    this.row = row;
  }

  private setStatus(status: BackendStatus, lastError: string | null = null) {
    this.status = status;
    this.lastError = lastError;
    void db
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

  private buildTransport(): Transport {
    switch (this.row.connectionType) {
      case "stdio": {
        if (!this.row.command) throw new Error("stdio server missing command");
        let env = this.row.env ?? undefined;
        if (this.row.key === BUILTIN_GATEWAY_TOOLS_SERVER_KEY) {
          const port = process.env.PORT || "3000";
          env = { ...(env ?? {}), MCP_GATEWAY_BASE_URL: env?.MCP_GATEWAY_BASE_URL ?? `http://127.0.0.1:${port}` };
        }
        const transport = new StdioClientTransport({
          command: this.row.command,
          args: this.row.args ?? [],
          env,
        });
        transport.onclose = () => {
          if (!this.closed) {
            this.setStatus("disconnected", "backend process exited");
            this.scheduleReconnect();
          }
        };
        return transport;
      }
      case "http": {
        if (!this.row.url) throw new Error("http server missing url");
        return new StreamableHTTPClientTransport(new URL(this.row.url), {
          requestInit: this.row.headers
            ? { headers: this.row.headers }
            : undefined,
        });
      }
      case "sse": {
        if (!this.row.url) throw new Error("sse server missing url");
        return new SSEClientTransport(new URL(this.row.url), {
          requestInit: this.row.headers
            ? { headers: this.row.headers }
            : undefined,
        });
      }
      default:
        throw new Error(`unknown connection type: ${this.row.connectionType}`);
    }
  }

  async connect() {
    if (this.closed) return;
    this.setStatus("connecting");
    try {
      const client = new Client({ name: "mcp-gateway", version: "0.1.0" });
      const transport = this.buildTransport();
      await client.connect(transport);
      this.client = client;
      this.transport = transport;
      this.reconnectDelay = RECONNECT_INITIAL_MS;
      this.setStatus("connected");
    } catch (err) {
      this.client = null;
      this.transport = null;
      this.setStatus("error", err instanceof Error ? err.message : String(err));
      if (this.row.connectionType !== "stdio") {
        this.scheduleReconnect();
      }
    }
  }

  private scheduleReconnect() {
    if (this.closed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  async close() {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.client) {
      await this.client.close().catch(() => {});
      this.client = null;
    }
    this.transport = null;
    this.setStatus("disconnected");
  }
}

declare global {
  var __gatewayConnections: Map<string, BackendConnection> | undefined;
  var __gatewayBackendRegistryBootPromise: Promise<void> | undefined;
}

const connections = globalThis.__gatewayConnections ?? new Map<string, BackendConnection>();
if (process.env.NODE_ENV !== "production") {
  globalThis.__gatewayConnections = connections;
}

export async function bootstrapBackendRegistry() {
  if (globalThis.__gatewayBackendRegistryBootPromise) return globalThis.__gatewayBackendRegistryBootPromise;

  globalThis.__gatewayBackendRegistryBootPromise = (async () => {
    const rows = await db.select().from(backendServers).where(eq(backendServers.enabled, true));
    await Promise.all(rows.map((row) => addOrReplaceConnection(row)));
  })();

  return globalThis.__gatewayBackendRegistryBootPromise;
}

export async function addOrReplaceConnection(row: BackendServer) {
  const existing = connections.get(row.id);
  if (existing) await existing.close();

  const conn = new BackendConnection(row);
  connections.set(row.id, conn);
  if (row.enabled) {
    await conn.connect();
  }
  return conn;
}

export async function removeConnection(id: string) {
  const existing = connections.get(id);
  if (existing) {
    await existing.close();
    connections.delete(id);
  }
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

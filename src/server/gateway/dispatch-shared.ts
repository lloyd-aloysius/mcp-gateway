import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { auditLog, backendServers, clientEndpoints, endpointClients, type ClientEndpoint } from "../db/schema";
import { prepareArgsForAudit } from "../audit/redact";
import { emitGatewayEvent } from "../events/bus";

export async function getServerRow(serverId: string) {
  const [row] = await getDb().select().from(backendServers).where(eq(backendServers.id, serverId)).limit(1);
  return row ?? null;
}

let lastFailureLog = 0;

function reportAuditFailure(): void {
  const now = Date.now();
  if (now - lastFailureLog < 60_000) return;
  lastFailureLog = now;
  console.warn("mcp-gateway: audit persistence failed");
}

const MAX_OBSERVED_CLIENTS_PER_ENDPOINT = 1_000;

function recordObservedClient(endpointId: string, clientId: string): void {
  getDb().transaction((tx) => {
    const now = new Date();
    const updated = tx.update(endpointClients).set({ lastSeenAt: now })
      .where(and(eq(endpointClients.endpointId, endpointId), eq(endpointClients.clientId, clientId)))
      .run();
    if (updated.changes > 0) return;

    const atCapacity = tx.select({ id: endpointClients.id }).from(endpointClients)
      .where(eq(endpointClients.endpointId, endpointId))
      .limit(1).offset(MAX_OBSERVED_CLIENTS_PER_ENDPOINT - 1).get();
    if (!atCapacity) {
      tx.insert(endpointClients).values({
        id: randomUUID(), endpointId, clientId, firstSeenAt: now, lastSeenAt: now,
      }).run();
    }
  });
}

export async function recordAudit(entry: {
  endpoint: ClientEndpoint;
  backendServerId?: string | null;
  backendServerKey?: string | null;
  sessionId?: string | null;
  clientId?: string | null;
  operationType:
    | "tools/list"
    | "tools/call"
    | "resources/list"
    | "resources/templates/list"
    | "resources/read"
    | "prompts/list"
    | "prompts/get";
  itemName?: string | null;
  args?: unknown;
  status: "success" | "error" | "denied";
  durationMs?: number;
  errorMessage?: string;
}) {
  let row: { id: number } | undefined;
  try {
    const { json, truncated } = prepareArgsForAudit(entry.args);
    [row] = await getDb()
      .insert(auditLog)
      .values({
        endpointId: entry.endpoint.id,
        endpointNameSnapshot: entry.endpoint.name,
        backendServerId: entry.backendServerId ?? null,
        backendServerKeySnapshot: entry.backendServerKey ?? null,
        sessionId: entry.sessionId ?? null,
        clientId: entry.clientId ?? null,
        operationType: entry.operationType,
        itemName: entry.itemName ?? null,
        requestArgsJson: json,
        requestArgsTruncated: truncated,
        status: entry.status,
        durationMs: entry.durationMs ?? null,
        errorMessage: entry.errorMessage ?? null,
      })
      .returning({ id: auditLog.id });
  } catch {
    reportAuditFailure();
    return;
  }

  void getDb()
    .update(clientEndpoints)
    .set({ lastUsedAt: new Date() })
    .where(eq(clientEndpoints.id, entry.endpoint.id))
    .catch(() => {});

  if (entry.clientId) {
    try {
      recordObservedClient(entry.endpoint.id, entry.clientId);
    } catch {
      reportAuditFailure();
    }
  }

  if (row) emitGatewayEvent({ type: "audit.appended", entryId: row.id });
}

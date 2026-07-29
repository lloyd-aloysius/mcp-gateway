import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { auditLog, backendServers, clientEndpoints, endpointClients, type ClientEndpoint } from "../db/schema";
import { prepareArgsForAudit } from "../audit/redact";
import { emitGatewayEvent } from "../events/bus";

// Kept as its own leaf module, not part of dispatch.ts: the elicitation/
// sampling relay (elicitation-sampling-relay.ts) needs recordAudit/
// getServerRow too, and it's imported from backend-registry.ts - which
// dispatch.ts already imports FROM (getAllConnections/getConnectionByKey).
// If these lived in dispatch.ts instead, backend-registry.ts importing them
// back would create a direct two-file import cycle.

export async function getServerRow(serverId: string) {
  const [row] = await db.select().from(backendServers).where(eq(backendServers.id, serverId)).limit(1);
  return row ?? null;
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
    | "resources/read"
    | "prompts/list"
    | "prompts/get"
    | "elicitation/create"
    | "sampling/createMessage";
  itemName?: string | null;
  args?: unknown;
  status: "success" | "error" | "denied";
  durationMs?: number;
  errorMessage?: string;
}) {
  const { json, truncated } = prepareArgsForAudit(entry.args);
  const [row] = await db
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

  void db
    .update(clientEndpoints)
    .set({ lastUsedAt: new Date() })
    .where(eq(clientEndpoints.id, entry.endpoint.id))
    .catch(() => {});

  if (entry.clientId) {
    const clientId = entry.clientId;
    void db
      .insert(endpointClients)
      .values({
        id: randomUUID(),
        endpointId: entry.endpoint.id,
        clientId,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [endpointClients.endpointId, endpointClients.clientId],
        set: { lastSeenAt: new Date() },
      })
      .catch(() => {});
  }

  if (row) emitGatewayEvent({ type: "audit.appended", entryId: row.id });
}

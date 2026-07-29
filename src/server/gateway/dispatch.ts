import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../db/client";
import { backendServerTools, type ClientEndpoint } from "../db/schema";
import { encodeName, decodeName, encodeResourceUri, decodeResourceUri } from "./namespacing";
import { evaluateAccess } from "./access-control";
import { getAllConnections, getConnectionByKey, type BackendConnection } from "./backend-registry";
import { registerInFlightCall, unregisterInFlightCall } from "./in-flight-calls";
import { recordAudit, getServerRow } from "./dispatch-shared";
import { emitGatewayEvent } from "../events/bus";

async function getDisabledToolNames(backendServerId: string): Promise<Set<string>> {
  const rows = await db
    .select({ toolName: backendServerTools.toolName })
    .from(backendServerTools)
    .where(and(eq(backendServerTools.backendServerId, backendServerId), eq(backendServerTools.enabled, false)));
  return new Set(rows.map((r) => r.toolName));
}

export class DispatchError extends Error {
  code: number;
  constructor(message: string, code = -32000) {
    super(message);
    this.code = code;
  }
}

async function allowedConnections(endpoint: ClientEndpoint): Promise<BackendConnection[]> {
  const conns = getAllConnections();
  const results = await Promise.allSettled(
    conns.map(async (conn) => {
      const row = await getServerRow(conn.id);
      if (!row) return null;
      const decision = await evaluateAccess(endpoint, row);
      return decision === "allow" ? conn : null;
    })
  );
  return results
    .filter((r): r is PromiseFulfilledResult<BackendConnection | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((c): c is BackendConnection => c !== null && c.status === "connected" && c.client !== null);
}

export async function dispatchListTools(
  endpoint: ClientEndpoint,
  sessionId: string | null,
  clientId: string | null
) {
  const conns = await allowedConnections(endpoint);
  const results = await Promise.allSettled(
    conns.map(async (conn) => {
      const [{ tools }, disabled] = await Promise.all([conn.client!.listTools(), getDisabledToolNames(conn.id)]);
      return tools
        .filter((t) => !disabled.has(t.name))
        .map((t) => ({ ...t, name: encodeName(conn.key, t.name) }));
    })
  );
  await recordAudit({ endpoint, sessionId, clientId, operationType: "tools/list", status: "success" });
  return results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => (r as PromiseFulfilledResult<unknown[]>).value);
}

export async function dispatchCallTool(
  endpoint: ClientEndpoint,
  namespacedName: string,
  args: Record<string, unknown> | undefined,
  sessionId: string | null,
  clientId: string | null
) {
  const callId = randomUUID();
  const decoded = decodeName(namespacedName);
  if (!decoded) {
    throw new DispatchError(`Unknown tool: ${namespacedName}`);
  }
  const conn = getConnectionByKey(decoded.serverKey);
  const row = conn ? await getServerRow(conn.id) : null;

  if (!conn || !row) {
    await recordAudit({
      endpoint,
      backendServerKey: decoded.serverKey,
      sessionId,
      clientId,
      operationType: "tools/call",
      itemName: namespacedName,
      args,
      status: "denied",
      errorMessage: "backend server not found",
    });
    throw new DispatchError(`Unknown backend server: ${decoded.serverKey}`);
  }

  const decision = await evaluateAccess(endpoint, row);
  if (decision === "deny") {
    // Access is denied at the gateway before it ever reaches the backend server, so the
    // live event deliberately omits backendServerId/Key — the visualization should only
    // animate endpoint -> gateway, not gateway -> server, for a blocked call.
    emitGatewayEvent({
      type: "call.started",
      callId,
      endpointId: endpoint.id,
      endpointName: endpoint.name,
      backendServerId: null,
      backendServerKey: null,
      itemName: namespacedName,
      operationType: "tools/call",
      sessionId,
      clientId,
    });
    await recordAudit({
      endpoint,
      backendServerId: row.id,
      backendServerKey: row.key,
      sessionId,
      clientId,
      operationType: "tools/call",
      itemName: namespacedName,
      args,
      status: "denied",
      errorMessage: "access denied by endpoint policy",
    });
    emitGatewayEvent({ type: "call.finished", callId, status: "denied", durationMs: 0 });
    throw new DispatchError(`Access denied for tool: ${namespacedName}`);
  }

  const disabledTools = await getDisabledToolNames(row.id);
  if (disabledTools.has(decoded.originalName)) {
    // Tool is disabled at the gateway (global per-server kill switch), never reaching the
    // backend — mirror the access-denied branch above so the diagram/audit trail treat it
    // identically to a policy denial.
    emitGatewayEvent({
      type: "call.started",
      callId,
      endpointId: endpoint.id,
      endpointName: endpoint.name,
      backendServerId: null,
      backendServerKey: null,
      itemName: namespacedName,
      operationType: "tools/call",
      sessionId,
      clientId,
    });
    await recordAudit({
      endpoint,
      backendServerId: row.id,
      backendServerKey: row.key,
      sessionId,
      clientId,
      operationType: "tools/call",
      itemName: namespacedName,
      args,
      status: "denied",
      errorMessage: "tool disabled",
    });
    emitGatewayEvent({ type: "call.finished", callId, status: "denied", durationMs: 0 });
    throw new DispatchError(`Tool disabled: ${namespacedName}`);
  }

  emitGatewayEvent({
    type: "call.started",
    callId,
    endpointId: endpoint.id,
    endpointName: endpoint.name,
    backendServerId: row.id,
    backendServerKey: row.key,
    itemName: namespacedName,
    operationType: "tools/call",
    sessionId,
    clientId,
  });

  const startedAt = Date.now();
  // Tracked so an elicitation/sampling request arriving on this connection
  // mid-call (this shared conn.client can have several endpoints' calls in
  // flight at once) can be traced back to this specific call - see
  // in-flight-calls.ts for why the SDK gives us no way to do this itself.
  registerInFlightCall(conn.id, { callId, endpointId: endpoint.id, sessionId, clientId, startedAt });
  try {
    if (!conn.client) throw new DispatchError("backend not connected");
    const result = await conn.client.callTool({ name: decoded.originalName, arguments: args });
    const durationMs = Date.now() - startedAt;
    await recordAudit({
      endpoint,
      backendServerId: row.id,
      backendServerKey: row.key,
      sessionId,
      clientId,
      operationType: "tools/call",
      itemName: namespacedName,
      args,
      status: "success",
      durationMs,
    });
    emitGatewayEvent({ type: "call.finished", callId, status: "success", durationMs });
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const errorMessage = err instanceof Error ? err.message : String(err);
    await recordAudit({
      endpoint,
      backendServerId: row.id,
      backendServerKey: row.key,
      sessionId,
      clientId,
      operationType: "tools/call",
      itemName: namespacedName,
      args,
      status: "error",
      durationMs,
      errorMessage,
    });
    emitGatewayEvent({ type: "call.finished", callId, status: "error", durationMs, error: errorMessage });
    throw err;
  } finally {
    unregisterInFlightCall(conn.id, callId);
  }
}

export async function dispatchListResources(
  endpoint: ClientEndpoint,
  sessionId: string | null,
  clientId: string | null
) {
  const conns = await allowedConnections(endpoint);
  const results = await Promise.allSettled(
    conns.map(async (conn) => {
      const { resources } = await conn.client!.listResources();
      return resources.map((r) => ({ ...r, uri: encodeResourceUri(conn.key, r.uri) }));
    })
  );
  await recordAudit({ endpoint, sessionId, clientId, operationType: "resources/list", status: "success" });
  return results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => (r as PromiseFulfilledResult<unknown[]>).value);
}

export async function dispatchReadResource(
  endpoint: ClientEndpoint,
  gatewayUri: string,
  sessionId: string | null,
  clientId: string | null
) {
  const decoded = decodeResourceUri(gatewayUri);
  if (!decoded) throw new DispatchError(`Unknown resource: ${gatewayUri}`);
  const conn = getConnectionByKey(decoded.serverKey);
  const row = conn ? await getServerRow(conn.id) : null;
  if (!conn || !row) throw new DispatchError(`Unknown backend server: ${decoded.serverKey}`);

  const decision = await evaluateAccess(endpoint, row);
  if (decision === "deny") {
    await recordAudit({
      endpoint,
      backendServerId: row.id,
      backendServerKey: row.key,
      sessionId,
      clientId,
      operationType: "resources/read",
      itemName: gatewayUri,
      status: "denied",
      errorMessage: "access denied by endpoint policy",
    });
    throw new DispatchError(`Access denied for resource: ${gatewayUri}`);
  }

  const startedAt = Date.now();
  try {
    const result = await conn.client!.readResource({ uri: decoded.originalUri });
    await recordAudit({
      endpoint,
      backendServerId: row.id,
      backendServerKey: row.key,
      sessionId,
      clientId,
      operationType: "resources/read",
      itemName: gatewayUri,
      status: "success",
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (err) {
    await recordAudit({
      endpoint,
      backendServerId: row.id,
      backendServerKey: row.key,
      sessionId,
      clientId,
      operationType: "resources/read",
      itemName: gatewayUri,
      status: "error",
      durationMs: Date.now() - startedAt,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export async function dispatchListPrompts(
  endpoint: ClientEndpoint,
  sessionId: string | null,
  clientId: string | null
) {
  const conns = await allowedConnections(endpoint);
  const results = await Promise.allSettled(
    conns.map(async (conn) => {
      const { prompts } = await conn.client!.listPrompts();
      return prompts.map((p) => ({ ...p, name: encodeName(conn.key, p.name) }));
    })
  );
  await recordAudit({ endpoint, sessionId, clientId, operationType: "prompts/list", status: "success" });
  return results
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => (r as PromiseFulfilledResult<unknown[]>).value);
}

export async function dispatchGetPrompt(
  endpoint: ClientEndpoint,
  namespacedName: string,
  args: Record<string, string> | undefined,
  sessionId: string | null,
  clientId: string | null
) {
  const decoded = decodeName(namespacedName);
  if (!decoded) throw new DispatchError(`Unknown prompt: ${namespacedName}`);
  const conn = getConnectionByKey(decoded.serverKey);
  const row = conn ? await getServerRow(conn.id) : null;
  if (!conn || !row) throw new DispatchError(`Unknown backend server: ${decoded.serverKey}`);

  const decision = await evaluateAccess(endpoint, row);
  if (decision === "deny") {
    await recordAudit({
      endpoint,
      backendServerId: row.id,
      backendServerKey: row.key,
      sessionId,
      clientId,
      operationType: "prompts/get",
      itemName: namespacedName,
      status: "denied",
      errorMessage: "access denied by endpoint policy",
    });
    throw new DispatchError(`Access denied for prompt: ${namespacedName}`);
  }

  const startedAt = Date.now();
  try {
    const result = await conn.client!.getPrompt({ name: decoded.originalName, arguments: args });
    await recordAudit({
      endpoint,
      clientId,
      backendServerId: row.id,
      backendServerKey: row.key,
      sessionId,
      operationType: "prompts/get",
      itemName: namespacedName,
      status: "success",
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (err) {
    await recordAudit({
      endpoint,
      backendServerId: row.id,
      backendServerKey: row.key,
      sessionId,
      clientId,
      operationType: "prompts/get",
      itemName: namespacedName,
      status: "error",
      durationMs: Date.now() - startedAt,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

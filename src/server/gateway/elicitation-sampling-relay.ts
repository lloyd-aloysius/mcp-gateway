import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { McpError, ErrorCode, type ElicitRequestParams, type CreateMessageRequestParams } from "@modelcontextprotocol/sdk/types.js";
import { db } from "../db/client";
import { clientEndpoints, type ClientEndpoint } from "../db/schema";
import { recordAudit, getServerRow } from "./dispatch-shared";
import { resolveInFlightCall } from "./in-flight-calls";
import { getSessionEntry } from "./session-registry";
import { emitGatewayEvent } from "../events/bus";

// Bounded timeouts matter here specifically because a relay sits in the
// middle of an otherwise-ordinary tool call: if the real end client never
// responds (disconnected mid-elicitation, user never answers), the hang
// propagates all the way up - end client -> relay -> backend's tool handler
// -> conn.client.callTool() -> the original gateway HTTP request never
// resolves. 10 minutes for elicitation matches @modelcontextprotocol/server-
// everything's own real-world precedent for form-mode prompts; sampling
// (LLM latency, no human involved) gets a shorter default.
const ELICITATION_TIMEOUT_MS = 10 * 60 * 1000;
const SAMPLING_TIMEOUT_MS = 2 * 60 * 1000;

interface RelayContext {
  callId: string;
  endpoint: ClientEndpoint;
  backendServerId: string;
  backendServerKey: string;
  sessionId: string | null;
  clientId: string | null;
}

// Resolves which endpoint session's in-flight tool call a backend's
// elicitation/sampling request belongs to, and loads that session's live
// Server + endpoint row so the relay functions below can check capabilities
// and audit against it. Throws a clean McpError for every way this can
// legitimately fail (no in-flight call, session since closed) rather than
// letting a relay hang or crash - the backend is waiting on this request as
// part of an already-in-flight tools/call, so it needs a real answer.
async function resolveRelayContext(connectionId: string): Promise<{
  context: RelayContext;
  server: Server;
  ambiguousCount: number;
}> {
  const { call, ambiguousCount } = resolveInFlightCall(connectionId);
  if (!call) {
    throw new McpError(ErrorCode.InternalError, "No in-flight gateway call to relay this request to");
  }

  const row = await getServerRow(connectionId);
  const endpointRow = await db
    .select()
    .from(clientEndpoints)
    .where(eq(clientEndpoints.id, call.endpointId))
    .limit(1)
    .then(([r]) => r ?? null);
  if (!row || !endpointRow) {
    throw new McpError(ErrorCode.InternalError, "Backend server or endpoint no longer exists");
  }

  const sessionEntry = call.sessionId ? getSessionEntry(call.sessionId) : undefined;
  if (!sessionEntry) {
    throw new McpError(ErrorCode.InternalError, "The connected client's session has since closed");
  }

  return {
    context: {
      callId: call.callId,
      endpoint: endpointRow,
      backendServerId: row.id,
      backendServerKey: row.key,
      sessionId: call.sessionId,
      clientId: call.clientId,
    },
    server: sessionEntry.server,
    ambiguousCount,
  };
}

export async function relayElicitation(connectionId: string, params: ElicitRequestParams) {
  const { context, server, ambiguousCount } = await resolveRelayContext(connectionId);
  const relayCallId = randomUUID();

  if (!server.getClientCapabilities()?.elicitation) {
    await recordAudit({
      endpoint: context.endpoint,
      backendServerId: context.backendServerId,
      backendServerKey: context.backendServerKey,
      sessionId: context.sessionId,
      clientId: context.clientId,
      operationType: "elicitation/create",
      status: "denied",
      errorMessage: "connected client does not support elicitation",
    });
    throw new McpError(ErrorCode.InvalidRequest, "Connected client does not support elicitation");
  }

  emitGatewayEvent({
    type: "call.started",
    callId: relayCallId,
    endpointId: context.endpoint.id,
    endpointName: context.endpoint.name,
    backendServerId: context.backendServerId,
    backendServerKey: context.backendServerKey,
    itemName: "elicitation/create",
    operationType: "elicitation/create",
    sessionId: context.sessionId,
    clientId: context.clientId,
  });

  const startedAt = Date.now();
  try {
    const result = await server.elicitInput(params, { timeout: ELICITATION_TIMEOUT_MS });
    const durationMs = Date.now() - startedAt;
    await recordAudit({
      endpoint: context.endpoint,
      backendServerId: context.backendServerId,
      backendServerKey: context.backendServerKey,
      sessionId: context.sessionId,
      clientId: context.clientId,
      operationType: "elicitation/create",
      status: "success",
      durationMs,
      // A best-effort choice, not a bug: the MCP protocol gives no way for a
      // backend to say which of several concurrent in-flight calls on a
      // shared connection an elicitation request belongs to. Recorded here
      // (reusing errorMessage on an otherwise-successful row) so it's
      // visible rather than silently guessed.
      errorMessage:
        ambiguousCount > 1
          ? `ambiguous relay target: ${ambiguousCount} concurrent in-flight calls on this connection; resolved to most recently started`
          : undefined,
    });
    emitGatewayEvent({ type: "call.finished", callId: relayCallId, status: "success", durationMs });
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const errorMessage = err instanceof Error ? err.message : String(err);
    await recordAudit({
      endpoint: context.endpoint,
      backendServerId: context.backendServerId,
      backendServerKey: context.backendServerKey,
      sessionId: context.sessionId,
      clientId: context.clientId,
      operationType: "elicitation/create",
      status: "error",
      durationMs,
      errorMessage,
    });
    emitGatewayEvent({ type: "call.finished", callId: relayCallId, status: "error", durationMs, error: errorMessage });
    throw err instanceof McpError ? err : new McpError(ErrorCode.InternalError, errorMessage);
  }
}

export async function relaySampling(connectionId: string, params: CreateMessageRequestParams) {
  const { context, server, ambiguousCount } = await resolveRelayContext(connectionId);
  const relayCallId = randomUUID();

  if (!server.getClientCapabilities()?.sampling) {
    await recordAudit({
      endpoint: context.endpoint,
      backendServerId: context.backendServerId,
      backendServerKey: context.backendServerKey,
      sessionId: context.sessionId,
      clientId: context.clientId,
      operationType: "sampling/createMessage",
      status: "denied",
      errorMessage: "connected client does not support sampling",
    });
    throw new McpError(ErrorCode.InvalidRequest, "Connected client does not support sampling");
  }

  emitGatewayEvent({
    type: "call.started",
    callId: relayCallId,
    endpointId: context.endpoint.id,
    endpointName: context.endpoint.name,
    backendServerId: context.backendServerId,
    backendServerKey: context.backendServerKey,
    itemName: "sampling/createMessage",
    operationType: "sampling/createMessage",
    sessionId: context.sessionId,
    clientId: context.clientId,
  });

  const startedAt = Date.now();
  try {
    const result = await server.createMessage(params, { timeout: SAMPLING_TIMEOUT_MS });
    const durationMs = Date.now() - startedAt;
    await recordAudit({
      endpoint: context.endpoint,
      backendServerId: context.backendServerId,
      backendServerKey: context.backendServerKey,
      sessionId: context.sessionId,
      clientId: context.clientId,
      operationType: "sampling/createMessage",
      status: "success",
      durationMs,
      errorMessage:
        ambiguousCount > 1
          ? `ambiguous relay target: ${ambiguousCount} concurrent in-flight calls on this connection; resolved to most recently started`
          : undefined,
    });
    emitGatewayEvent({ type: "call.finished", callId: relayCallId, status: "success", durationMs });
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const errorMessage = err instanceof Error ? err.message : String(err);
    await recordAudit({
      endpoint: context.endpoint,
      backendServerId: context.backendServerId,
      backendServerKey: context.backendServerKey,
      sessionId: context.sessionId,
      clientId: context.clientId,
      operationType: "sampling/createMessage",
      status: "error",
      durationMs,
      errorMessage,
    });
    emitGatewayEvent({ type: "call.finished", callId: relayCallId, status: "error", durationMs, error: errorMessage });
    throw err instanceof McpError ? err : new McpError(ErrorCode.InternalError, errorMessage);
  }
}

import { randomUUID } from "node:crypto";
import { getDb } from "../db/client";
import { backendServers, type ClientEndpoint } from "../db/schema";
import { encodeName, decodeName, encodeResourceUri, decodeResourceUri, encodeResourceTemplate } from "./namespacing";
import { evaluateAccess } from "./access-control";
import { getAllConnections, getConnectionByKey, type BackendConnection } from "./backend-registry";
import { BUILTIN_GATEWAY_TOOLS_SERVER_KEY } from "./seed-builtin-server";
import { recordAudit, getServerRow } from "./dispatch-shared";
import { emitGatewayEvent } from "../events/bus";
import { listBackendItems, requestBackend } from "./backend-requests";

import { callIsolatedBackend, interactiveRouteEnabled, type InteractiveCallContext } from "./interactive-call";
import { getToolPolicy } from "./tool-policy";

async function listBackendSummaries() {
  const servers = await getDb().select({
    id: backendServers.id,
    key: backendServers.key,
    name: backendServers.name,
    connectionType: backendServers.connectionType,
    enabled: backendServers.enabled,
    status: backendServers.status,
  }).from(backendServers);
  return { content: [{ type: "text" as const, text: JSON.stringify(servers, null, 2) }] };
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
  clientId: string | null,
  signal?: AbortSignal
) {
  const conns = await allowedConnections(endpoint);
  const results = await Promise.allSettled(
    conns.filter((conn) => conn.client?.getServerCapabilities()?.tools).map(async (conn) => {
      const [{ items: tools, partial }, policy] = await Promise.all([
        requestBackend(conn, signal, (client, options) => listBackendItems(async (cursor) => {
          const page = await client.listTools({ cursor }, options);
          return { items: page.tools, nextCursor: page.nextCursor };
        }), 5_000),
        getToolPolicy(endpoint.id, conn.id, conn.key),
      ]);
      return { partial, items: tools
        .filter((t) => policy.denial(t.name) === null)
        .map((t) => ({ ...t, name: encodeName(conn.key, t.name) })) };

    })
  );
  const partial = results.some((result) => result.status === "rejected" || result.value.partial);
  await recordAudit({ endpoint, sessionId, clientId, operationType: "tools/list",
    status: partial ? "error" : "success", errorMessage: partial ? "Partial backend discovery" : undefined });
  return {
    tools: results.flatMap((result) => result.status === "fulfilled" ? result.value.items : []),
    ...(partial ? { _meta: { "mcp-gateway/partial": true } } : {}),
  };
}

export async function dispatchCallTool(
  endpoint: ClientEndpoint,
  namespacedName: string,
  args: Record<string, unknown> | undefined,
  sessionId: string | null,
  clientId: string | null,
  signal?: AbortSignal,
  interactive?: InteractiveCallContext
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

  const toolDenial = (await getToolPolicy(endpoint.id, row.id, row.key)).denial(decoded.originalName);
  if (toolDenial) {
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
      errorMessage: toolDenial,
    });
    emitGatewayEvent({ type: "call.finished", callId, status: "denied", durationMs: 0 });
    throw new DispatchError(`${toolDenial}: ${namespacedName}`);
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
  try {
    if (!conn.client) throw new DispatchError("backend not connected");
    const params = { name: decoded.originalName, arguments: args };
    const result = row.key === BUILTIN_GATEWAY_TOOLS_SERVER_KEY && params.name === "list_backend_servers"
      ? await listBackendSummaries()
      : interactive && interactiveRouteEnabled(endpoint.slug, row.key)
        ? await callIsolatedBackend(conn, params, interactive)
        : await requestBackend(conn, signal, (client, options) => client.callTool(params, undefined, options));
    const durationMs = Date.now() - startedAt;
    const status = "isError" in result && result.isError ? "error" : "success";
    await recordAudit({
      endpoint,
      backendServerId: row.id,
      backendServerKey: row.key,
      sessionId,
      clientId,
      operationType: "tools/call",
      itemName: namespacedName,
      args,
      status,
      durationMs,
    });
    emitGatewayEvent({ type: "call.finished", callId, status, durationMs });
    return result;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const errorMessage = "Backend tool request failed";
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
    if (err instanceof DispatchError) throw err;
    throw new DispatchError("Backend request failed");
  }
}

export async function dispatchListResources(
  endpoint: ClientEndpoint,
  sessionId: string | null,
  clientId: string | null,
  signal?: AbortSignal
) {
  const conns = await allowedConnections(endpoint);
  const results = await Promise.allSettled(
    conns.filter((conn) => conn.client?.getServerCapabilities()?.resources).map(async (conn) => {
      const { items, partial } = await requestBackend(conn, signal, (client, options) => listBackendItems(async (cursor) => {
        const page = await client.listResources({ cursor }, options);
        return { items: page.resources, nextCursor: page.nextCursor };
      }), 5_000);
      return { partial, items: items.map((r) => ({ ...r, uri: encodeResourceUri(conn.key, r.uri) })) };
    })
  );
  const partial = results.some((result) => result.status === "rejected" || result.value.partial);
  await recordAudit({ endpoint, sessionId, clientId, operationType: "resources/list",
    status: partial ? "error" : "success", errorMessage: partial ? "Partial backend discovery" : undefined });
  return {
    resources: results.flatMap((result) => result.status === "fulfilled" ? result.value.items : []),
    ...(partial ? { _meta: { "mcp-gateway/partial": true } } : {}),
  };
}

export async function dispatchListResourceTemplates(
  endpoint: ClientEndpoint,
  sessionId: string | null,
  clientId: string | null,
  signal?: AbortSignal
) {
  const conns = await allowedConnections(endpoint);
  const results = await Promise.allSettled(
    conns.filter((conn) => conn.client?.getServerCapabilities()?.resources).map(async (conn) => {
      const { items, partial } = await requestBackend(conn, signal, (client, options) => listBackendItems(async (cursor) => {
        const page = await client.listResourceTemplates({ cursor }, options);
        return { items: page.resourceTemplates, nextCursor: page.nextCursor };
      }), 5_000);
      return { partial, items: items.map((template) => ({
        ...template, uriTemplate: encodeResourceTemplate(conn.key, template.uriTemplate),
      })) };
    })
  );
  const partial = results.some((result) => result.status === "rejected" || result.value.partial);
  await recordAudit({ endpoint, sessionId, clientId, operationType: "resources/templates/list",
    status: partial ? "error" : "success", errorMessage: partial ? "Partial backend discovery" : undefined });
  return {
    resourceTemplates: results.flatMap((result) => result.status === "fulfilled" ? result.value.items : []),
    ...(partial ? { _meta: { "mcp-gateway/partial": true } } : {}),
  };
}

export async function dispatchReadResource(
  endpoint: ClientEndpoint,
  gatewayUri: string,
  sessionId: string | null,
  clientId: string | null,
  signal?: AbortSignal
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
    const result = await requestBackend(conn, signal, (client, options) => client.readResource({ uri: decoded.originalUri }, options));
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
    return { ...result, contents: result.contents.map((entry) => ({ ...entry, uri: encodeResourceUri(conn.key, entry.uri) })) };
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
      errorMessage: "Backend request failed",
    });
    if (err instanceof DispatchError) throw err;
    throw new DispatchError("Backend request failed");
  }
}

export async function dispatchListPrompts(
  endpoint: ClientEndpoint,
  sessionId: string | null,
  clientId: string | null,
  signal?: AbortSignal
) {
  const conns = await allowedConnections(endpoint);
  const results = await Promise.allSettled(
    conns.filter((conn) => conn.client?.getServerCapabilities()?.prompts).map(async (conn) => {
      const { items, partial } = await requestBackend(conn, signal, (client, options) => listBackendItems(async (cursor) => {
        const page = await client.listPrompts({ cursor }, options);
        return { items: page.prompts, nextCursor: page.nextCursor };
      }), 5_000);
      return { partial, items: items.map((p) => ({ ...p, name: encodeName(conn.key, p.name) })) };
    })
  );
  const partial = results.some((result) => result.status === "rejected" || result.value.partial);
  await recordAudit({ endpoint, sessionId, clientId, operationType: "prompts/list",
    status: partial ? "error" : "success", errorMessage: partial ? "Partial backend discovery" : undefined });
  return {
    prompts: results.flatMap((result) => result.status === "fulfilled" ? result.value.items : []),
    ...(partial ? { _meta: { "mcp-gateway/partial": true } } : {}),
  };
}

export async function dispatchGetPrompt(
  endpoint: ClientEndpoint,
  namespacedName: string,
  args: Record<string, string> | undefined,
  sessionId: string | null,
  clientId: string | null,
  signal?: AbortSignal
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
    const result = await requestBackend(conn, signal, (client, options) => client.getPrompt({ name: decoded.originalName, arguments: args }, options));
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
      errorMessage: "Backend request failed",
    });
    if (err instanceof DispatchError) throw err;
    throw new DispatchError("Backend request failed");
  }
}

import { gatewayVersion } from "../../lib/gateway-version";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  ErrorCode,
  McpError,
  isInitializeRequest,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client";
import { clientEndpoints } from "../db/schema";
import {
  dispatchListTools,
  dispatchCallTool,
  dispatchListResources,
  dispatchListResourceTemplates,
  dispatchReadResource,
  dispatchListPrompts,
  dispatchGetPrompt,
} from "./dispatch";
import type { AuthorizedEndpoint } from "./endpoint-auth";
import { setSession, deleteSession, getSessionEntry, refreshSession, reserveSession } from "./session-registry";

export {
  getActiveSessionCount,
  getActiveSessionCountByEndpoint,
} from "./session-registry";

function buildServer(
  authorization: AuthorizedEndpoint,
  getSessionId: () => string | null,
  clientId: string
): Server {
  const { endpoint, expiresAt } = authorization;
  const server = new Server(
    { name: `mcp-gateway:${endpoint.slug}`, version: gatewayVersion },
    { capabilities: { tools: { listChanged: true }, resources: { listChanged: true }, prompts: { listChanged: true } } }
  );

  async function getAuthorizedEndpoint() {
    const [current] = await getDb().select().from(clientEndpoints).where(eq(clientEndpoints.id, endpoint.id)).limit(1);
    if (!current?.enabled || current.tokenHash !== endpoint.tokenHash || (expiresAt && expiresAt <= Date.now())) {
      throw new McpError(ErrorCode.InvalidRequest, "Endpoint authorization has expired");
    }
    return current;
  }

  server.setRequestHandler(ListToolsRequestSchema, async (_request, { signal }) =>
    dispatchListTools(await getAuthorizedEndpoint(), getSessionId(), clientId, signal));

  server.setRequestHandler(CallToolRequestSchema, async (request, { signal, requestId }) => {
    const result = await dispatchCallTool(
      await getAuthorizedEndpoint(),
      request.params.name,
      request.params.arguments,
      getSessionId(),
      clientId,
      signal,
      { server, requestId, signal }
    );
    return result;
  });

  server.setRequestHandler(ListResourcesRequestSchema, async (_request, { signal }) =>
    dispatchListResources(await getAuthorizedEndpoint(), getSessionId(), clientId, signal));

  server.setRequestHandler(ListResourceTemplatesRequestSchema, async (_request, { signal }) =>
    dispatchListResourceTemplates(await getAuthorizedEndpoint(), getSessionId(), clientId, signal));

  server.setRequestHandler(ReadResourceRequestSchema, async (request, { signal }) => {
    const result = await dispatchReadResource(await getAuthorizedEndpoint(), request.params.uri, getSessionId(), clientId, signal);
    return result;
  });

  server.setRequestHandler(ListPromptsRequestSchema, async (_request, { signal }) =>
    dispatchListPrompts(await getAuthorizedEndpoint(), getSessionId(), clientId, signal));

  server.setRequestHandler(GetPromptRequestSchema, async (request, { signal }) => {
    const result = await dispatchGetPrompt(
      await getAuthorizedEndpoint(),
      request.params.name,
      request.params.arguments,
      getSessionId(),
      clientId,
      signal
    );
    return result;
  });

  return server;
}

export async function handleMcpRequest(authorization: AuthorizedEndpoint, req: Request, parsedBody?: unknown): Promise<Response> {
  const { endpoint, credentialId } = authorization;
  const sessionId = req.headers.get("mcp-session-id");

  if (sessionId) {
    const entry = getSessionEntry(sessionId);
    if (!entry || entry.endpointId !== endpoint.id || entry.tokenHash !== endpoint.tokenHash || entry.credentialId !== credentialId) {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null }),
        { status: 404, headers: { "content-type": "application/json" } }
      );
    }
    refreshSession(entry);
    return entry.transport.handleRequest(req, { parsedBody });
  }

  if (req.method !== "POST" || !isInitializeRequest(parsedBody)) {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Initialize a session first" } },
      { status: 400 });
  }
  const release = reserveSession(endpoint.id);
  if (!release) {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "MCP session limit reached" } },
      { status: 429 });
  }
  try {
    return await initializeSession(authorization, req, parsedBody);
  } finally {
    release();
  }
}

async function initializeSession(authorization: AuthorizedEndpoint, req: Request, parsedBody: unknown): Promise<Response> {
  const { endpoint, credentialId, expiresAt } = authorization;
  const clientId = req.headers.get("x-mcp-client-id")?.slice(0, 128) ?? `client-${randomUUID().slice(0, 8)}`;

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sid) => {
      setSession(sid, { server, transport, endpointId: endpoint.id, tokenHash: endpoint.tokenHash, credentialId, credentialExpiresAt: expiresAt });
    },
    onsessionclosed: (sid) => {
      deleteSession(sid);
    },
  });

  const server = buildServer(
    authorization,
    () => transport.sessionId ?? null,
    clientId
  );
  await server.connect(transport);

  return transport.handleRequest(req, { parsedBody });
}

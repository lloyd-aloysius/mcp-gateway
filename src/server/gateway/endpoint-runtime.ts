import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { ClientEndpoint } from "../db/schema";
import {
  dispatchListTools,
  dispatchCallTool,
  dispatchListResources,
  dispatchReadResource,
  dispatchListPrompts,
  dispatchGetPrompt,
} from "./dispatch";

interface SessionEntry {
  server: Server;
  transport: WebStandardStreamableHTTPServerTransport;
  endpointId: string;
  clientId: string;
}

const sessions = new Map<string, SessionEntry>();

function buildServer(
  endpoint: ClientEndpoint,
  getSessionId: () => string | null,
  getClientId: () => string | null
): Server {
  const server = new Server(
    { name: `mcp-gateway:${endpoint.slug}`, version: "0.1.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: await dispatchListTools(endpoint, getSessionId(), getClientId()),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await dispatchCallTool(
      endpoint,
      request.params.name,
      request.params.arguments,
      getSessionId(),
      getClientId()
    );
    return result;
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: await dispatchListResources(endpoint, getSessionId(), getClientId()),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const result = await dispatchReadResource(endpoint, request.params.uri, getSessionId(), getClientId());
    return result;
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: await dispatchListPrompts(endpoint, getSessionId(), getClientId()),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const result = await dispatchGetPrompt(
      endpoint,
      request.params.name,
      request.params.arguments,
      getSessionId(),
      getClientId()
    );
    return result;
  });

  return server;
}

export async function handleMcpRequest(endpoint: ClientEndpoint, req: Request): Promise<Response> {
  const sessionId = req.headers.get("mcp-session-id");

  if (sessionId) {
    const entry = sessions.get(sessionId);
    if (!entry || entry.endpointId !== endpoint.id) {
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null }),
        { status: 404, headers: { "content-type": "application/json" } }
      );
    }
    return entry.transport.handleRequest(req);
  }

  const clientId = req.headers.get("x-mcp-client-id") ?? `client-${randomUUID().slice(0, 8)}`;

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (sid) => {
      sessions.set(sid, { server, transport, endpointId: endpoint.id, clientId });
    },
    onsessionclosed: (sid) => {
      sessions.delete(sid);
    },
  });

  const server = buildServer(
    endpoint,
    () => transport.sessionId ?? null,
    () => sessions.get(transport.sessionId ?? "")?.clientId ?? null
  );
  await server.connect(transport);

  return transport.handleRequest(req);
}

export function getActiveSessionCount(): number {
  return sessions.size;
}

export function getActiveSessionCountByEndpoint(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of sessions.values()) {
    counts.set(entry.endpointId, (counts.get(entry.endpointId) ?? 0) + 1);
  }
  return counts;
}

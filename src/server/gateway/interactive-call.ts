import { gatewayVersion } from "../../lib/gateway-version";
import { Client, getSupportedElicitationModes } from "@modelcontextprotocol/sdk/client/index.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CreateMessageRequestSchema,
  ElicitRequestSchema,
  ErrorCode,
  McpError,
  type CallToolRequest,
  type CallToolResult,
  type RequestId,
} from "@modelcontextprotocol/sdk/types.js";
import type { BackendConnection } from "./backend-registry";

const MAX_ISOLATED_CALLS = 4;
let active = 0;

export function interactiveRouteEnabled(endpoint: string, backend: string): boolean {
  const pair = endpoint + ":" + backend;
  return (process.env.MCP_GATEWAY_INTERACTIVE_ROUTES ?? "").split(",").some((entry) => entry.trim() === pair);
}

export interface InteractiveCallContext {
  server: Server;
  requestId: RequestId;
  signal: AbortSignal;
}

export async function callIsolatedBackend(
  connection: BackendConnection,
  params: CallToolRequest["params"],
  { server, requestId, signal }: InteractiveCallContext,
): Promise<CallToolResult> {
  if (active >= MAX_ISOLATED_CALLS) throw new Error("Interactive backend capacity reached");
  signal.throwIfAborted();
  const capabilities = server.getClientCapabilities();
  const form = getSupportedElicitationModes(capabilities?.elicitation).supportsFormMode;
  const sampling = capabilities?.sampling !== undefined;
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(60_000)]);
  const client = new Client({ name: "mcp-gateway-isolated", version: gatewayVersion }, {
    capabilities: {
      ...(form ? { elicitation: { form: {} } } : {}),
      ...(sampling ? { sampling: {} } : {}),
    },
  });
  let forwarding = false;
  let callbackCount = 0;
  function callbackOptions() {
    if (!forwarding || deadline.aborted) {
      throw new McpError(ErrorCode.InvalidRequest, "No active originating tool call");
    }
    if (++callbackCount > 4) throw new McpError(ErrorCode.InvalidRequest, "Interactive callback limit reached");
    return { relatedRequestId: requestId, signal: deadline, timeout: 45_000 };
  }

  if (form) {
    client.setRequestHandler(ElicitRequestSchema, ({ params }) => {
      if (params.mode === "url") throw new McpError(ErrorCode.InvalidRequest, "URL elicitation is disabled");
      return server.elicitInput(params, callbackOptions());
    });
  }
  if (sampling) {
    client.setRequestHandler(CreateMessageRequestSchema, ({ params }) => {
      if (params.maxTokens > 4_096) throw new McpError(ErrorCode.InvalidParams, "Sampling token limit exceeded");
      return server.createMessage(params, callbackOptions());
    });
  }

  active++;
  const abort = () => { void client.close().catch(() => {}); };
  deadline.addEventListener("abort", abort, { once: true });
  let initializeTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      client.connect(connection.createTransport(), { timeout: 10_000, signal: deadline }),
      new Promise<never>((_, reject) => {
        initializeTimer = setTimeout(() => reject(new Error("Interactive backend connection timed out")), 12_000);
      }),
    ]);
    deadline.throwIfAborted();
    forwarding = true;
    return await client.callTool(params, undefined, { signal: deadline, timeout: 60_000 }) as CallToolResult;
  } finally {
    forwarding = false;
    if (initializeTimer !== undefined) clearTimeout(initializeTimer);
    deadline.removeEventListener("abort", abort);
    await client.close().catch(() => {});
    active--;
  }
}

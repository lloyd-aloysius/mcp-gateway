#!/usr/bin/env node
// Built-in stdio MCP server, auto-seeded once by src/server/gateway/seed-builtin-server.ts,
// spawned like any other stdio backend via BackendConnection. Exposes tools for checking that
// the gateway process itself is alive and responsive, plus admin tools for managing backend
// servers by calling back into the gateway's own admin API over loopback HTTP.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "gateway-tools", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

function getBaseUrl() {
  return process.env.MCP_GATEWAY_BASE_URL ?? `http://127.0.0.1:${process.env.PORT || "3000"}`;
}

// Only the fields safe to hand back to an MCP client — the full row includes env/headers,
// which can contain live secrets (e.g. an Authorization bearer token), and must never be
// relayed through a tool result.
function pickServerSummary(row) {
  const { id, key, name, connectionType, enabled, status } = row;
  return { id, key, name, connectionType, enabled, status };
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "ping",
      description: "Replies with pong and the current server time.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "gateway_status",
      description: "Returns process uptime, PID, and memory usage for this gateway process.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "list_backend_servers",
      description:
        "List the gateway's currently configured backend MCP servers (id, key, name, connectionType, enabled, status). " +
        "Does not include connection secrets such as env vars, headers, command, or URL.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "add_backend_server",
      description:
        "Add a new backend MCP server to the gateway. connectionType determines which fields are required: " +
        "'stdio' requires command (and accepts args, env); 'http' and 'sse' require url (and accept headers). " +
        "command is required when connectionType is 'stdio'; url is required when connectionType is 'http' or 'sse'. " +
        "key must be unique and contain only letters, numbers, and hyphens — it's used as the tool-name namespace " +
        "prefix for every tool this new server exposes. " +
        "Note: this tool calls the gateway's own admin API over 127.0.0.1 — if the gateway's HOST is bound to a " +
        "single non-loopback interface, this call may fail even though the dashboard itself works fine.",
      inputSchema: {
        type: "object",
        properties: {
          connectionType: { type: "string", enum: ["stdio", "http", "sse"] },
          key: {
            type: "string",
            pattern: "^[a-zA-Z0-9-]+$",
            description: "Unique identifier, letters/numbers/hyphens only",
          },
          name: { type: "string", description: "Human-readable display name" },
          description: { type: "string" },
          command: { type: "string", description: "Required when connectionType is 'stdio', e.g. 'npx'" },
          args: {
            type: "array",
            items: { type: "string" },
            description: "One entry per command-line argument (stdio only)",
          },
          env: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "Environment variables for the spawned process (stdio only)",
          },
          url: { type: "string", description: "Required when connectionType is 'http' or 'sse'" },
          headers: {
            type: "object",
            additionalProperties: { type: "string" },
            description: "Request headers, e.g. Authorization (http/sse only)",
          },
          enabled: { type: "boolean", default: true },
        },
        required: ["connectionType", "key", "name"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    case "ping":
      return { content: [{ type: "text", text: `pong at ${new Date().toISOString()}` }] };
    case "gateway_status":
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { pid: process.pid, uptimeSeconds: process.uptime(), memoryUsage: process.memoryUsage() },
              null,
              2
            ),
          },
        ],
      };
    case "list_backend_servers": {
      try {
        const res = await fetch(`${getBaseUrl()}/api/servers`);
        if (!res.ok) {
          return { content: [{ type: "text", text: `Failed to list servers: HTTP ${res.status}` }], isError: true };
        }
        const rows = await res.json();
        const summary = rows.map(pickServerSummary);
        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to reach gateway admin API: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
    case "add_backend_server": {
      try {
        const res = await fetch(`${getBaseUrl()}/api/servers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request.params.arguments ?? {}),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          const message =
            res.status === 409
              ? (data?.error ?? "A server with this key already exists")
              : `Validation failed: ${JSON.stringify(data?.error ?? data)}`;
          return { content: [{ type: "text", text: message }], isError: true };
        }
        return { content: [{ type: "text", text: JSON.stringify(pickServerSummary(data), null, 2) }] };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Failed to reach gateway admin API: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    }
    default:
      throw new Error(`Unknown tool: ${request.params.name}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

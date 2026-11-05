#!/usr/bin/env node
// Built-in stdio MCP server, auto-seeded once by src/server/gateway/seed-builtin-server.ts,
// spawned like any other stdio backend via BackendConnection. Exposes tools for checking that
// the gateway is alive. The gateway itself handles backend inventory requests.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "gateway-tools", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

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
    default:
      throw new Error(`Unknown tool: ${request.params.name}`);
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

import { withAdmin } from "@/server/http/admin";
import { getGatewayHealth } from "@/server/gateway/health";

export const GET = withAdmin(async () => {
  const health = await getGatewayHealth();
  const metrics = [
    "# TYPE mcp_gateway_ready gauge",
    `mcp_gateway_ready ${Number(health.ready)}`,
    "# TYPE mcp_gateway_active_sessions gauge",
    `mcp_gateway_active_sessions ${health.activeSessions}`,
    "# TYPE mcp_gateway_tool_calls_last_hour gauge",
    ...health.toolCallsLastHour.map(({ status, count }) => `mcp_gateway_tool_calls_last_hour{status="${status}"} ${count}`),
    "# TYPE mcp_gateway_tool_call_mean_seconds_last_hour gauge",
    ...health.toolCallsLastHour.map(({ status, averageMs }) =>
      `mcp_gateway_tool_call_mean_seconds_last_hour{status="${status}"} ${(averageMs ?? 0) / 1000}`),
  ];
  return new Response(metrics.join("\n") + "\n", {
    headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8" },
  });
});

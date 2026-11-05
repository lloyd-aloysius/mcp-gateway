import { withAdmin } from "@/server/http/admin";
import { getGatewayHealth } from "@/server/gateway/health";

export const GET = withAdmin(async () => {
  const health = await getGatewayHealth();
  return Response.json(health, { status: health.ready ? 200 : 503 });
});

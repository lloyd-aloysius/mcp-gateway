import { resolveEndpointFromRequest } from "@/server/gateway/endpoint-auth";
import { handleMcpRequest } from "@/server/gateway/endpoint-runtime";

async function handle(req: Request, params: Promise<{ slug: string }>) {
  const { slug } = await params;
  const result = await resolveEndpointFromRequest(slug, req);
  if ("error" in result) {
    return new Response(JSON.stringify({ error: result.error }), {
      status: result.status,
      headers: { "content-type": "application/json" },
    });
  }
  return handleMcpRequest(result.endpoint, req);
}

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  return handle(req, ctx.params);
}

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  return handle(req, ctx.params);
}

export async function DELETE(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  return handle(req, ctx.params);
}

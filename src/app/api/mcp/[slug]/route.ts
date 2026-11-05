import { consumeEndpointRequest } from "@/server/http/rate-limit";
import { InvalidRequestBody, MCP_BODY_BYTES, readJsonBody } from "@/server/http/json-body";
import { validateMcpOrigin } from "@/server/http/admin";
import { resolveEndpointFromRequest } from "@/server/gateway/endpoint-auth";
import { handleMcpRequest } from "@/server/gateway/endpoint-runtime";

async function handle(req: Request, params: Promise<{ slug: string }>) {
  const denied = validateMcpOrigin(req);
  if (denied) return denied;
  const { slug } = await params;
  const result = await resolveEndpointFromRequest(slug, req);
  if ("error" in result) {
    return new Response(JSON.stringify({ error: result.error }), {
      status: result.status,
      headers: { "content-type": "application/json", "cache-control": "no-store",
        ...(result.challenge ? { "www-authenticate": result.challenge } : {}) },
    });
  }
  if (!consumeEndpointRequest(result.endpoint.id)) {
    return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "MCP request limit reached" } },
      { status: 429, headers: { "retry-after": "60" } });
  }
  try {
    const body = req.method === "POST" ? await readJsonBody(req, MCP_BODY_BYTES) : undefined;
    if (Array.isArray(body) && body.length > 16) {
      throw new InvalidRequestBody(413, "MCP batch is too large");
    }
    return await handleMcpRequest(result, req, body);
  } catch (error) {
    if (error instanceof InvalidRequestBody) {
      return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: error.message } },
        { status: error.status });
    }
    throw error;
  }
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

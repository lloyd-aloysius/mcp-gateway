import { getOAuthConfig } from "@/server/gateway/oauth";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,128}$/.test(slug)) return new Response(null, { status: 404 });
  try {
    const config = getOAuthConfig(slug);
    if (!config) return new Response(null, { status: 404 });
    return Response.json({
      resource: config.resource.href,
      authorization_servers: [config.issuer],
      scopes_supported: [config.scope],
      bearer_methods_supported: ["header"],
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "OAuth configuration is incomplete" }, { status: 503 });
  }
}

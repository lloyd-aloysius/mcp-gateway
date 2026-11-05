import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

interface OAuthConfig {
  issuer: string;
  jwks: URL;
  resource: URL;
  metadata: URL;
  scope: string;
  introspection?: { url: URL; authorization: string };
}

function httpsUrl(value?: string): URL {
  if (!value) throw new Error("Missing OAuth setting");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search) {
    throw new Error("OAuth endpoints must be HTTPS URLs");
  }
  return url;
}

export function isOAuthEndpoint(slug: string): boolean {
  return (process.env.MCP_GATEWAY_OAUTH_ENDPOINTS ?? "").split(",").some((value) => value.trim() === slug);
}

export function getOAuthConfig(slug: string): OAuthConfig | null {
  if (!isOAuthEndpoint(slug)) return null;
  const issuer = process.env.MCP_GATEWAY_OAUTH_ISSUER ?? "";
  httpsUrl(issuer);
  const origin = httpsUrl(process.env.MCP_GATEWAY_OAUTH_RESOURCE_ORIGIN);
  if (origin.pathname !== "/") throw new Error("OAuth resource origin cannot contain a path");

  const resource = new URL("/api/mcp/" + slug, origin);
  const metadata = new URL("/.well-known/oauth-protected-resource" + resource.pathname, origin);
  const jwks = httpsUrl(process.env.MCP_GATEWAY_OAUTH_JWKS_URL);
  const scope = "mcp:" + slug;
  const url = process.env.MCP_GATEWAY_OAUTH_INTROSPECTION_URL;
  const clientId = process.env.MCP_GATEWAY_OAUTH_INTROSPECTION_ID;
  const secret = process.env.MCP_GATEWAY_OAUTH_INTROSPECTION_SECRET;
  if (url || clientId || secret) {
    if (!clientId || !secret) throw new Error("OAuth introspection credentials are incomplete");
    const formValue = (value: string) => new URLSearchParams({ value }).toString().slice("value=".length);
    const encoded = Buffer.from(formValue(clientId) + ":" + formValue(secret)).toString("base64");
    return { issuer, jwks, resource, metadata, scope, introspection: {
      url: httpsUrl(url), authorization: "Basic " + encoded,
    } };
  }
  return { issuer, jwks, resource, metadata, scope };
}

let cached: { url: string; getKey: JWTVerifyGetKey } | undefined;

function issuerKeys(url: URL): JWTVerifyGetKey {
  if (cached?.url !== url.href) {
    cached = { url: url.href, getKey: createRemoteJWKSet(url, { timeoutDuration: 5_000 }) };
  }
  return cached.getKey;
}

export async function verifyAccessToken(token: string, config: OAuthConfig, getKey = issuerKeys(config.jwks)) {
  const { payload } = await jwtVerify(token, getKey, {
    algorithms: ["RS256", "ES256"],
    audience: config.resource.href,
    issuer: config.issuer,
    typ: "at+jwt",
    maxTokenAge: "15m",
    requiredClaims: ["iat", "exp", "sub", "client_id", "jti"],
  });
  if (!payload.iat || !payload.exp || payload.exp - payload.iat > 15 * 60) {
    throw new Error("Access token lifetime exceeds policy");
  }
  const scopeGranted = typeof payload.scope === "string" && payload.scope.split(/\s+/).includes(config.scope);
  if (scopeGranted && config.introspection) {
    const response = await fetch(config.introspection.url, {
      method: "POST",
      redirect: "error",
      headers: { authorization: config.introspection.authorization, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token, token_type_hint: "access_token" }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok || (await response.json()).active !== true) throw new Error("Access token is inactive");
  }
  return { expiresAt: payload.exp * 1000, scopeGranted };
}

export function oauthChallenge(config: OAuthConfig, error?: "invalid_token" | "insufficient_scope"): string {
  return [`Bearer resource_metadata="${config.metadata.href}"`, `scope="${config.scope}"`,
    ...(error ? [`error="${error}"`] : [])].join(", ");
}

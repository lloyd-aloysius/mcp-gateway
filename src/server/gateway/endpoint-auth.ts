import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { clientEndpoints, type ClientEndpoint } from "../db/schema";
import { hashToken } from "../tokens";
import { getOAuthConfig, oauthChallenge, verifyAccessToken } from "./oauth";

export interface AuthorizedEndpoint {
  endpoint: ClientEndpoint;
  credentialId: string;
  expiresAt?: number;
}

export async function resolveEndpointFromRequest(
  slug: string,
  req: Request
): Promise<AuthorizedEndpoint | { error: string; status: number; challenge?: string }> {
  const [endpoint] = await getDb().select().from(clientEndpoints).where(eq(clientEndpoints.slug, slug)).limit(1);
  if (!endpoint) return { error: "Endpoint not found", status: 404 };
  if (!endpoint.enabled) return { error: "Endpoint disabled", status: 403 };

  const bearer = /^Bearer (\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  let oauth;
  try {
    oauth = getOAuthConfig(slug);
  } catch {
    return { error: "OAuth configuration is incomplete", status: 503 };
  }

  if (oauth) {
    if (!bearer || bearer.length > 8192) {
      return { error: "Unauthorized", status: 401, challenge: oauthChallenge(oauth) };
    }
    try {
      const { expiresAt, scopeGranted } = await verifyAccessToken(bearer, oauth);
      if (!scopeGranted) {
        return { error: "Insufficient scope", status: 403, challenge: oauthChallenge(oauth, "insufficient_scope") };
      }
      return { endpoint, credentialId: hashToken(bearer), expiresAt };
    } catch {
      return { error: "Unauthorized", status: 401, challenge: oauthChallenge(oauth, "invalid_token") };
    }
  }

  const supplied = Buffer.from(hashToken(bearer ?? ""));
  const expected = Buffer.from(endpoint.tokenHash);
  if (!bearer || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return { error: "Unauthorized", status: 401, challenge: "Bearer" };
  }
  return { endpoint, credentialId: endpoint.tokenHash };
}

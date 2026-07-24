import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { clientEndpoints, type ClientEndpoint } from "../db/schema";
import { hashToken } from "../tokens";

export async function resolveEndpointFromRequest(
  slug: string,
  req: Request
): Promise<{ endpoint: ClientEndpoint } | { error: string; status: number }> {
  const [endpoint] = await db
    .select()
    .from(clientEndpoints)
    .where(eq(clientEndpoints.slug, slug))
    .limit(1);

  if (!endpoint) return { error: "Endpoint not found", status: 404 };
  if (!endpoint.enabled) return { error: "Endpoint disabled", status: 403 };

  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!bearerToken || hashToken(bearerToken) !== endpoint.tokenHash) {
    return { error: "Unauthorized", status: 401 };
  }

  return { endpoint };
}

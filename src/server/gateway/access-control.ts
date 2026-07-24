import { eq, and } from "drizzle-orm";
import { db } from "../db/client";
import { endpointServerRules, type ClientEndpoint, type BackendServer } from "../db/schema";

export type AccessDecision = "allow" | "deny";

export async function evaluateAccess(
  endpoint: ClientEndpoint,
  server: BackendServer
): Promise<AccessDecision> {
  if (!endpoint.enabled) return "deny";
  if (!server.enabled || server.status !== "connected") return "deny";

  const [rule] = await db
    .select()
    .from(endpointServerRules)
    .where(
      and(
        eq(endpointServerRules.endpointId, endpoint.id),
        eq(endpointServerRules.backendServerId, server.id)
      )
    )
    .limit(1);

  if (rule) return rule.access;
  return endpoint.defaultPolicy === "allow_all" ? "allow" : "deny";
}

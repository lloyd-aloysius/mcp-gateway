import { inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import { clientEndpoints } from "../db/schema";
import { evaluateAccess } from "./access-control";
import { getServerRow } from "./dispatch-shared";
import { activeSessions } from "./session-registry";

export async function relayInventoryChange(
  backendId: string,
  kind: "tools" | "resources" | "prompts",
): Promise<void> {
  const sessions = activeSessions();
  if (!sessions.length) return;
  const backend = await getServerRow(backendId);
  if (!backend) return;
  const ids = [...new Set(sessions.map(({ endpointId }) => endpointId))];
  const endpoints = await getDb().select().from(clientEndpoints).where(inArray(clientEndpoints.id, ids));
  const allowed = new Map<string, string>();
  await Promise.all(endpoints.map(async (endpoint) => {
    if (await evaluateAccess(endpoint, backend) === "allow") allowed.set(endpoint.id, endpoint.tokenHash);
  }));

  await Promise.allSettled(sessions.filter((entry) => allowed.get(entry.endpointId) === entry.tokenHash)
    .map(({ server }) => {
      if (kind === "tools") return server.sendToolListChanged();
      if (kind === "resources") return server.sendResourceListChanged();
      return server.sendPromptListChanged();
    }));
}

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

// Kept as its own leaf module (no imports from dispatch.ts/backend-registry.ts)
// so backend-registry.ts can look up a session's Server instance to relay
// elicitation/sampling requests to it, without creating an import cycle -
// endpoint-runtime.ts already imports from dispatch.ts, which imports from
// backend-registry.ts.
export interface SessionEntry {
  server: Server;
  transport: WebStandardStreamableHTTPServerTransport;
  endpointId: string;
  clientId: string;
}

const sessions = new Map<string, SessionEntry>();

export function setSession(sessionId: string, entry: SessionEntry): void {
  sessions.set(sessionId, entry);
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function getSessionEntry(sessionId: string): SessionEntry | undefined {
  return sessions.get(sessionId);
}

export function getActiveSessionCount(): number {
  return sessions.size;
}

export function getActiveSessionCountByEndpoint(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of sessions.values()) {
    counts.set(entry.endpointId, (counts.get(entry.endpointId) ?? 0) + 1);
  }
  return counts;
}

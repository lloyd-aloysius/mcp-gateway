import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

const SESSION_IDLE_MS = 30 * 60_000;
const MAX_SESSIONS = 256;
const MAX_ENDPOINT_SESSIONS = 64;

interface SessionEntry {
  server: Server;
  transport: WebStandardStreamableHTTPServerTransport;
  endpointId: string;
  tokenHash: string;
  credentialId: string;
  credentialExpiresAt?: number;
  expiresAt: number;
}

interface SessionRegistry {
  sessions: Map<string, SessionEntry>;
  pending: Map<string, number>;
  pendingCount: number;
}

declare global {
  var __gatewaySessionTimer: ReturnType<typeof setInterval> | undefined;
  var __gatewaySessionRegistry: SessionRegistry | undefined;
}

const registry = (globalThis.__gatewaySessionRegistry ??= {
  sessions: new Map(),
  pending: new Map(),
  pendingCount: 0,
});
const { sessions, pending } = registry;

function expireSessions(): void {
  const now = Date.now();
  for (const [id, entry] of sessions) {
    if (entry.expiresAt <= now) {
      sessions.delete(id);
      void entry.transport.close().catch(() => {});
    }
  }
}

export function startSessionMaintenance(): void {
  globalThis.__gatewaySessionTimer ??= setInterval(expireSessions, 60_000).unref();
}

export function reserveSession(endpointId: string): (() => void) | null {
  expireSessions();
  if (sessions.size + registry.pendingCount >= MAX_SESSIONS) return null;

  let endpointSessions = pending.get(endpointId) ?? 0;
  for (const entry of sessions.values()) {
    if (entry.endpointId === endpointId) endpointSessions++;
  }
  if (endpointSessions >= MAX_ENDPOINT_SESSIONS) return null;

  pending.set(endpointId, (pending.get(endpointId) ?? 0) + 1);
  registry.pendingCount++;
  return () => {
    const count = pending.get(endpointId) ?? 0;
    if (count === 1) pending.delete(endpointId);
    else pending.set(endpointId, count - 1);
    registry.pendingCount--;
  };
}

export function setSession(sessionId: string, entry: Omit<SessionEntry, "expiresAt">): void {
  sessions.set(sessionId, { ...entry, expiresAt: Math.min(Date.now() + SESSION_IDLE_MS, entry.credentialExpiresAt ?? Infinity) });
}

export function deleteSession(sessionId: string): void {
  sessions.delete(sessionId);
}

export function getSessionEntry(sessionId: string): SessionEntry | undefined {
  const entry = sessions.get(sessionId);
  if (entry && entry.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    void entry.transport.close().catch(() => {});
    return;
  }
  return entry;
}

export async function closeEndpointSessions(endpointId: string): Promise<void> {
  const closing = [];
  for (const [id, entry] of sessions) {
    if (entry.endpointId !== endpointId) continue;
    sessions.delete(id);
    closing.push(entry.transport.close());
  }
  await Promise.allSettled(closing);
}

export function getActiveSessionCount(): number {
  expireSessions();
  return sessions.size;
}

export function getActiveSessionCountByEndpoint(): Map<string, number> {
  expireSessions();
  const counts = new Map<string, number>();
  for (const entry of sessions.values()) {
    counts.set(entry.endpointId, (counts.get(entry.endpointId) ?? 0) + 1);
  }
  return counts;
}

export function refreshSession(entry: SessionEntry): void {
  entry.expiresAt = Math.min(Date.now() + SESSION_IDLE_MS, entry.credentialExpiresAt ?? Infinity);
}


export function activeSessions(): SessionEntry[] {
  expireSessions();
  return [...sessions.values()];
}

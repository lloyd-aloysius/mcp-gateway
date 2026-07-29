// Elicitation/sampling requests arrive on a backend server's shared Client
// connection with no session/request correlation id anywhere in the MCP
// protocol or the SDK's own plumbing - Protocol._requestMessageId is a bare
// per-instance counter, and RequestHandlerExtra.sessionId reflects the
// *backend's* transport session, not which of our own endpoint sessions
// currently has a tool call in flight on this connection. Since one backend
// connection is a process-wide singleton potentially serving many endpoints
// concurrently, this has to be tracked explicitly by the app - there's no
// shortcut in the SDK for it.
export interface InFlightCall {
  callId: string;
  endpointId: string;
  sessionId: string | null;
  clientId: string | null;
  startedAt: number;
}

const byConnection = new Map<string, Map<string, InFlightCall>>();

export function registerInFlightCall(connectionId: string, call: InFlightCall): void {
  let calls = byConnection.get(connectionId);
  if (!calls) {
    calls = new Map();
    byConnection.set(connectionId, calls);
  }
  calls.set(call.callId, call);
}

export function unregisterInFlightCall(connectionId: string, callId: string): void {
  const calls = byConnection.get(connectionId);
  if (!calls) return;
  calls.delete(callId);
  if (calls.size === 0) byConnection.delete(connectionId);
}

export interface ResolvedInFlightCall {
  call: InFlightCall | null;
  // >0 means multiple calls were in flight on this connection at once - the
  // protocol gives no way to know which one an elicitation/sampling request
  // actually belongs to, so the most-recently-started call is used as a
  // documented best-effort heuristic. Callers should surface this (e.g. in
  // an audit log entry) rather than silently guessing.
  ambiguousCount: number;
}

export function resolveInFlightCall(connectionId: string): ResolvedInFlightCall {
  const calls = byConnection.get(connectionId);
  if (!calls || calls.size === 0) return { call: null, ambiguousCount: 0 };
  if (calls.size === 1) return { call: [...calls.values()][0], ambiguousCount: 0 };

  let mostRecent: InFlightCall | null = null;
  for (const call of calls.values()) {
    if (!mostRecent || call.startedAt > mostRecent.startedAt) mostRecent = call;
  }
  return { call: mostRecent, ambiguousCount: calls.size };
}

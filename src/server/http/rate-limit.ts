const WINDOW_MS = 60_000;
const MAX_ENDPOINT_REQUESTS = 360;
const MAX_TOTAL_REQUESTS = 3_600;

interface RequestWindow {
  resetsAt: number;
  total: number;
  byEndpoint: Map<string, number>;
}

declare global {
  var __gatewayRequestWindow: RequestWindow | undefined;
}

export function consumeEndpointRequest(endpointId: string): boolean {
  const now = Date.now();
  let window = globalThis.__gatewayRequestWindow;
  if (!window || window.resetsAt <= now) {
    window = { resetsAt: now + WINDOW_MS, total: 0, byEndpoint: new Map() };
    globalThis.__gatewayRequestWindow = window;
  }
  const count = window.byEndpoint.get(endpointId) ?? 0;
  if (window.total >= MAX_TOTAL_REQUESTS || count >= MAX_ENDPOINT_REQUESTS) return false;
  window.total++;
  window.byEndpoint.set(endpointId, count + 1);
  return true;
}

// The origin allowlist restricts routing, not network identity. Enable only on a
// listener/reverse proxy that is reachable exclusively through the private tailnet.
export function viewerOrigins(): URL[] {
  return (process.env.MCP_GATEWAY_VIEWER_ORIGINS ?? "").split(",").flatMap((value) => {
    const entry = value.trim().replace(/\/$/, "");
    if (!entry) return [];
    try {
      const url = new URL(entry);
      return ["https:", "http:"].includes(url.protocol) && url.origin === entry && !url.hostname.includes("*") ? [url] : [];
    } catch { return []; }
  });
}

export function viewerHeaders(): Record<string, string> {
  return { "cache-control": "private, no-store", "vary": "Host, Origin", "x-content-type-options": "nosniff", "x-frame-options": "DENY", "content-security-policy": "frame-ancestors 'none'", "referrer-policy": "no-referrer" };
}

export function authorizeViewer(request: Request): Response | null {
  const origins = viewerOrigins();
  const failure = (status: number, error: string, extra?: Record<string, string>) => Response.json({ error }, { status, headers: { ...viewerHeaders(), ...extra } });
  if (!origins.length) return failure(404, "Visualization viewer is not enabled");
  // A private proxy can supply this key when the app also has another ingress.
  // Never send the key to the browser; the proxy must replace incoming values.
  const proxyKey = process.env.MCP_GATEWAY_VIEWER_PROXY_KEY;
  if (proxyKey && request.headers.get("x-mcp-gateway-viewer-key") !== proxyKey) return failure(403, "Private viewer proxy required");
  const host = request.headers.get("host")?.toLowerCase();
  const allowed = origins.filter((url) => url.host === host).map((url) => url.origin);
  if (!allowed.length) return failure(403, "Viewer host is not allowed");
  const origin = request.headers.get("origin");
  if (origin !== null && !allowed.includes(origin)) return failure(403, "Viewer origin is not allowed");
  if (request.headers.get("sec-fetch-site") === "cross-site" && request.headers.get("sec-fetch-mode") !== "navigate") return failure(403, "Cross-site viewer requests are not allowed");
  if (request.method !== "GET" && request.method !== "HEAD") return failure(405, "Visualization is read-only", { allow: "GET, HEAD" });
  return null;
}

const VIEWER_ASSETS = /^\/client-icons\/(?:claude|cursor|githubcopilot|hermes|openclaw|windsurf)\.svg$/;
export function isViewerRoute(path: string): boolean {
  return path === "/view" || path === "/api/viewer/snapshot" || path === "/api/viewer/events" || VIEWER_ASSETS.test(path);
}

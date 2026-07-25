import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Admin API routes have no login (by design — see SECURITY.md) and are
// meant to be reached only by this app's own dashboard, never by another
// origin. Without this, a page on any other origin can reach a mutating
// route with a "simple request" (Content-Type: text/plain, which skips the
// browser's CORS preflight entirely) and it goes straight through, since
// Request.json() parses the body regardless of the declared Content-Type.
// For a stdio backend server, that's remote code execution via whatever
// `command`/`args` the attacker's page POSTs.
//
// /api/mcp/[slug] is deliberately excluded: it's the actual gateway
// endpoint external MCP clients are meant to call from anywhere, protected
// by its own per-endpoint bearer token instead of same-origin checks.
const PROTECTED_PREFIXES = ["/api/servers", "/api/endpoints", "/api/settings"];
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function middleware(req: NextRequest) {
  if (!MUTATING_METHODS.has(req.method)) return NextResponse.next();
  if (!PROTECTED_PREFIXES.some((prefix) => req.nextUrl.pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  // A real cross-site browser request always carries Origin. Same-machine
  // tools calling the admin API directly (curl, scripts) typically don't -
  // that's an already-intended use of this no-login local API, not the
  // browser-driven vector this blocks, so an absent Origin is allowed.
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed" }, { status: 403 });
  }

  // Only enforce Content-Type when a body was actually sent - several
  // routes here (reconnect, reconnect-all, the Tailscale toggle) are
  // bodyless action triggers, and requiring JSON on those would break them.
  const contentLength = req.headers.get("content-length");
  const hasBody = contentLength !== null && contentLength !== "0";
  if (hasBody) {
    const contentType = req.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/servers/:path*", "/api/endpoints/:path*", "/api/settings/:path*"],
};

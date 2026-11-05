import { NextResponse, type NextRequest } from "next/server";
import { adminRequestOrigins, authorizeAdmin } from "./server/http/admin";

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // The session handler validates the trusted Host and Origin before reading credentials.
  if (path === "/api/admin/session") return NextResponse.next();

  const access = path === "/login" ? adminRequestOrigins(request) : authorizeAdmin(request);
  if (access instanceof Response) {
    if (access.status !== 401 || path.startsWith("/api/")) return access;
    const origins = adminRequestOrigins(request);
    if (origins instanceof Response) return origins;
    const origin = origins.find((value) => new URL(value).protocol === request.nextUrl.protocol) ?? origins[0];
    const redirect = NextResponse.redirect(new URL("/login", origin));
    redirect.headers.set("cache-control", "no-store");
    return redirect;
  }

  const response = NextResponse.next();
  response.headers.set("cache-control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!api/mcp/|\\.well-known/oauth-protected-resource/|api/health$|_next/static/|favicon.ico).*)"],
};

import { NextResponse, type NextRequest } from "next/server";
import { authorizeAdmin } from "./server/http/admin";

export function proxy(request: NextRequest) {
  return authorizeAdmin(request) ?? NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/mcp/|\\.well-known/oauth-protected-resource/|api/health$|_next/static/|favicon.ico).*)"],
};

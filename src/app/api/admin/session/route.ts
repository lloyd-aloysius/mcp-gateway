import { adminSessionOrigin, sameAdminSecret } from "@/server/http/admin";
import { consumeAdminLoginAttempt, endAdminSession, startAdminSession } from "@/server/http/admin-session";
import { InvalidRequestBody, readJsonBody } from "@/server/http/json-body";

function error(status: number, message: string, headers?: HeadersInit) {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store", ...headers } });
}

function sessionResponse(cookie: string) {
  return new Response(null, { status: 204, headers: { "set-cookie": cookie, "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const origin = adminSessionOrigin(request);
  if (origin instanceof Response) return origin;
  const token = process.env.MCP_GATEWAY_ADMIN_TOKEN;
  if (!token || token.length < 24) return error(503, "Configure an admin token of at least 24 characters.");
  const retryAfter = consumeAdminLoginAttempt();
  if (retryAfter) {
    return error(429, "Too many sign-in attempts. Try again in a minute.", { "retry-after": String(retryAfter) });
  }

  try {
    const body = await readJsonBody(request, 8 * 1024);
    const password = body && typeof body === "object" && "password" in body ? body.password : undefined;
    if (typeof password !== "string" || !sameAdminSecret(token, password)) {
      return error(401, "The admin token is incorrect.");
    }
    return sessionResponse(startAdminSession(request, token, origin));
  } catch (err) {
    if (err instanceof InvalidRequestBody) return error(err.status, err.message);
    throw err;
  }
}

export function DELETE(request: Request) {
  const origin = adminSessionOrigin(request);
  if (origin instanceof Response) return origin;
  return sessionResponse(endAdminSession(request, origin));
}

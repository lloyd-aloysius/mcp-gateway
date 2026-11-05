import { createHash, timingSafeEqual } from "node:crypto";
import { InvalidRequestBody } from "./json-body";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function originForHost(host: string | null): string | null {
  if (!host || /[\s/,@?#\\]/.test(host)) return null;
  try {
    const origin = new URL("http://" + host);
    return LOOPBACK_HOSTS.has(origin.hostname) ? origin.origin : null;
  } catch {
    return null;
  }
}

function configuredOrigins(variable: string): URL[] {
  return (process.env[variable] ?? "").split(",").flatMap((value) => {
    try {
      const url = new URL(value.trim());
      return ["https:", "http:"].includes(url.protocol) && url.origin === value.trim().replace(/\/$/, "")
        ? [url] : [];
    } catch {
      return [];
    }
  });
}

function matchesOrigin(request: Request, origins: string[]): boolean {
  const origin = request.headers.get("origin");
  return origin === null || origins.includes(origin);
}

export function validateMcpOrigin(request: Request): Response | null {
  const local = originForHost(request.headers.get("host"));
  const origins = configuredOrigins("MCP_GATEWAY_MCP_ORIGINS").map((url) => url.origin);
  if (local) origins.push(local);
  return matchesOrigin(request, origins) ? null : failure(403, "Origin is not allowed");
}

function failure(status: number, error: string, headers?: Record<string, string>): Response {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store", ...headers } });
}

function readCredential(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const bearer = /^Bearer (\S+)$/i.exec(authorization)?.[1];
  if (bearer) return bearer;
  const basic = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization)?.[1];
  if (!basic) return null;
  const decoded = Buffer.from(basic, "base64").toString("utf8");
  return decoded.startsWith("admin:") ? decoded.slice("admin:".length) : null;
}

function sameSecret(left: string, right: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(left), digest(right));
}

export function authorizeAdmin(request: Request): Response | null {
  const host = request.headers.get("host")?.toLowerCase() ?? null;
  const local = originForHost(host);
  const configured = configuredOrigins("MCP_GATEWAY_ADMIN_ORIGINS");
  const hasConfiguredOrigins = Boolean(process.env.MCP_GATEWAY_ADMIN_ORIGINS?.trim());
  const origins = configured.filter((url) => url.host === host).map((url) => url.origin);
  if (local && !hasConfiguredOrigins) origins.push(local);
  if (origins.length === 0) return failure(403, "Admin host is not allowed");
  if (!matchesOrigin(request, origins) ||
      (!READ_METHODS.has(request.method) && request.headers.get("sec-fetch-site") === "cross-site")) {
    return failure(403, "Admin origin is not allowed");
  }

  const token = process.env.MCP_GATEWAY_ADMIN_TOKEN;
  if (!token && local && !hasConfiguredOrigins && LOOPBACK_HOSTS.has(process.env.HOSTNAME ?? "")) {
    return null;
  }
  if (!token || token.length < 24) return failure(503, "Set a dedicated admin token of at least 24 characters");
  const credential = readCredential(request);
  return credential && sameSecret(token, credential) ? null : failure(401, "Admin authentication is required", {
    "www-authenticate": 'Basic realm="MCP Gateway Admin", charset="UTF-8"',
  });
}

export function withAdmin<Args extends unknown[]>(handler: (request: Request, ...args: Args) => Promise<Response>) {
  return async (request: Request, ...args: Args): Promise<Response> => {
    const denied = authorizeAdmin(request);
    if (denied) return denied;
    try {
      const response = await handler(request, ...args);
      response.headers.set("cache-control", "no-store");
      if (response.ok && !READ_METHODS.has(request.method)) {
        const { recordAdminChange } = await import("../audit/admin-change");
        await recordAdminChange(request);
      }
      return response;
    } catch (error) {
      if (error instanceof InvalidRequestBody) return failure(error.status, error.message);
      throw error;
    }
  };
}

import { createHash, randomBytes } from "node:crypto";

const COOKIE_NAME = "mcp_gateway_admin_session";
const SESSION_SECONDS = 12 * 60 * 60;
const MAX_SESSIONS = 128;
const MAX_LOGIN_ATTEMPTS = 20;

type Session = { origin: string; credentialHash: string; expiresAt: number };
type LoginWindow = { count: number; resetsAt: number };

declare global {
  var __gatewayAdminSessions: Map<string, Session> | undefined;
  var __gatewayAdminLoginWindow: LoginWindow | undefined;
}

function sessions() {
  return (globalThis.__gatewayAdminSessions ??= new Map<string, Session>());
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function sessionKey(request: Request) {
  const value = request.headers.get("cookie")?.split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(COOKIE_NAME + "="))
    ?.slice(COOKIE_NAME.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? digest(value) : null;
}

export function hasAdminSession(request: Request, token: string, origins: string[]): boolean {
  const key = sessionKey(request);
  if (!key) return false;
  const session = sessions().get(key);
  if (!session) return false;
  if (session.expiresAt <= Date.now() || session.credentialHash !== digest(token)) {
    sessions().delete(key);
    return false;
  }
  return origins.includes(session.origin);
}

function cookie(value: string, maxAge: number, origin: string) {
  const secure = origin.startsWith("https:") ? "; Secure" : "";
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

export function startAdminSession(request: Request, token: string, origin: string) {
  const now = Date.now();
  const active = sessions();
  const previous = sessionKey(request);
  if (previous) active.delete(previous);
  for (const [key, session] of active) {
    if (session.expiresAt <= now) active.delete(key);
  }
  if (active.size >= MAX_SESSIONS) {
    const oldest = active.keys().next().value;
    if (oldest) active.delete(oldest);
  }
  const value = randomBytes(32).toString("base64url");
  active.set(digest(value), { origin, credentialHash: digest(token), expiresAt: now + SESSION_SECONDS * 1000 });
  return cookie(value, SESSION_SECONDS, origin);
}

export function endAdminSession(request: Request, origin: string) {
  const key = sessionKey(request);
  if (key && sessions().get(key)?.origin === origin) sessions().delete(key);
  return cookie("", 0, origin);
}

export function consumeAdminLoginAttempt() {
  const now = Date.now();
  let window = globalThis.__gatewayAdminLoginWindow;
  if (!window || window.resetsAt <= now) {
    window = { count: 0, resetsAt: now + 60_000 };
    globalThis.__gatewayAdminLoginWindow = window;
  }
  if (window.count >= MAX_LOGIN_ATTEMPTS) return Math.ceil((window.resetsAt - now) / 1000);
  window.count++;
  return null;
}

export type ClientIdentity = { clientId: string; label?: string | null };

export function clientName(client?: ClientIdentity | null): string {
  return client?.label?.trim() || client?.clientId || "Unknown client";
}

// Match complete name segments, so names like "codex-mac" work without
// accidentally branding unrelated names such as "mycodexproxy".
export function clientPreset(client?: ClientIdentity | null) {
  const name = clientName(client).toLowerCase();
  if (/(^|[^a-z0-9])codex($|[^a-z0-9])/.test(name)) return "codex";
  if (/(^|[^a-z0-9])claude([\s_-]*code)?($|[^a-z0-9])/.test(name)) return "claude-code";
  if (/(^|[^a-z0-9])anti[\s_-]*gravity($|[^a-z0-9])/.test(name)) return "antigravity";
  return "generic";
}

export const CLIENT_PRESETS = {
  codex: { name: "Codex", color: "text-sky-600 dark:text-sky-300", background: "bg-sky-500/10 ring-sky-500/20" },
  "claude-code": { name: "Claude Code", color: "text-orange-600 dark:text-orange-300", background: "bg-orange-500/10 ring-orange-500/20" },
  antigravity: { name: "Antigravity", color: "text-violet-600 dark:text-violet-300", background: "bg-violet-500/10 ring-violet-500/20" },
  generic: { name: "MCP client", color: "text-slate-600 dark:text-slate-300", background: "bg-slate-500/10 ring-slate-500/20" },
} as const;

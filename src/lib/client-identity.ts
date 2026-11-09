export const CLIENT_ICON_IDS = ["auto", "codex", "claude-code", "claude-desktop", "antigravity", "openclaw", "hermes", "cursor", "windsurf", "github-copilot", "generic", "terminal", "bot", "browser", "service"] as const;
export type ClientIconSelection = typeof CLIENT_ICON_IDS[number];
export type ClientPreset = Exclude<ClientIconSelection, "auto">;
export type ClientIdentity = { clientId: string; label?: string | null; icon?: string | null };

export function clientName(client?: ClientIdentity | null): string {
  return client?.label?.trim() || client?.clientId || "Unknown client";
}

// Match complete name segments, so names like "codex-mac" work without
// accidentally branding unrelated names such as "mycodexproxy".
export function clientPreset(client?: ClientIdentity | null): ClientPreset {
  if (client?.icon && client.icon !== "auto" && Object.hasOwn(CLIENT_PRESETS, client.icon)) return client.icon as ClientPreset;
  const name = clientName(client).toLowerCase();
  if (/(^|[^a-z0-9])codex($|[^a-z0-9])/.test(name)) return "codex";
  if (/(^|[^a-z0-9])claude[\s_-]*desktop($|[^a-z0-9])/.test(name)) return "claude-desktop";
  if (/(^|[^a-z0-9])claude([\s_-]*code)?($|[^a-z0-9])/.test(name)) return "claude-code";
  if (/(^|[^a-z0-9])anti[\s_-]*gravity($|[^a-z0-9])/.test(name)) return "antigravity";
  if (/(^|[^a-z0-9])open[\s_-]*claw($|[^a-z0-9])/.test(name)) return "openclaw";
  if (/(^|[^a-z0-9])hermes($|[^a-z0-9])/.test(name)) return "hermes";
  if (/(^|[^a-z0-9])cursor($|[^a-z0-9])/.test(name)) return "cursor";
  if (/(^|[^a-z0-9])windsurf($|[^a-z0-9])/.test(name)) return "windsurf";
  if (/(^|[^a-z0-9])(github[\s_-]*)?copilot($|[^a-z0-9])/.test(name)) return "github-copilot";
  return "generic";
}

export const CLIENT_PRESETS = {
  codex: { name: "Codex", color: "text-sky-600 dark:text-sky-300", background: "bg-sky-500/10 ring-sky-500/20" },
  "claude-code": { name: "Claude Code", color: "text-orange-600 dark:text-orange-300", background: "bg-orange-500/10 ring-orange-500/20" },
  antigravity: { name: "Antigravity", color: "text-violet-600 dark:text-violet-300", background: "bg-violet-500/10 ring-violet-500/20" },
  "claude-desktop": { name: "Claude Desktop", color: "text-orange-600 dark:text-orange-300", background: "bg-orange-500/10 ring-orange-500/20" },
  openclaw: { name: "OpenClaw", color: "text-rose-600 dark:text-rose-300", background: "bg-rose-500/10 ring-rose-500/20" },
  hermes: { name: "Hermes", color: "text-amber-600 dark:text-amber-300", background: "bg-amber-500/10 ring-amber-500/20" },
  cursor: { name: "Cursor", color: "text-zinc-600 dark:text-zinc-200", background: "bg-zinc-500/10 ring-zinc-500/20" },
  windsurf: { name: "Windsurf", color: "text-teal-600 dark:text-teal-300", background: "bg-teal-500/10 ring-teal-500/20" },
  "github-copilot": { name: "GitHub Copilot", color: "text-indigo-600 dark:text-indigo-300", background: "bg-indigo-500/10 ring-indigo-500/20" },
  terminal: { name: "Terminal", color: "text-lime-700 dark:text-lime-300", background: "bg-lime-500/10 ring-lime-500/20" },
  bot: { name: "Bot / agent", color: "text-fuchsia-600 dark:text-fuchsia-300", background: "bg-fuchsia-500/10 ring-fuchsia-500/20" },
  browser: { name: "Web client", color: "text-blue-600 dark:text-blue-300", background: "bg-blue-500/10 ring-blue-500/20" },
  service: { name: "Service", color: "text-cyan-600 dark:text-cyan-300", background: "bg-cyan-500/10 ring-cyan-500/20" },
  generic: { name: "MCP client", color: "text-slate-600 dark:text-slate-300", background: "bg-slate-500/10 ring-slate-500/20" },
} as const;

import { Bot, Globe, Monitor, Server, Terminal } from "lucide-react";
import { clientPreset, CLIENT_PRESETS, type ClientIdentity } from "@/lib/client-identity";
import { cn } from "@/lib/utils";
import { ClientBrandMark } from "./client-brand-mark";

const GENERIC = { generic: Monitor, terminal: Terminal, bot: Bot, browser: Globe, service: Server };
const ASSETS = { "claude-desktop": "claude", openclaw: "openclaw", hermes: "hermes", cursor: "cursor", windsurf: "windsurf", "github-copilot": "githubcopilot" };

export function ClientAvatar({ client, className }: { client?: ClientIdentity | null; className?: string }) {
  const preset = clientPreset(client);
  const style = CLIENT_PRESETS[preset];
  const Icon = GENERIC[preset as keyof typeof GENERIC];
  const asset = ASSETS[preset as keyof typeof ASSETS];
  const automatic = !client?.icon || client.icon === "auto";
  return (
    <span title={`${style.name} · ${automatic ? "detected from client name" : "selected logo"}`} aria-label={style.name} data-client-preset={preset}
      className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset", style.color, style.background, className)}>
      {Icon ? <Icon aria-hidden="true" className="size-[55%]" strokeWidth={1.8} /> : asset ?
        <span aria-hidden="true" className="size-[65%] bg-current" style={{ mask: `url(/client-icons/${asset}.svg) center / contain no-repeat`, WebkitMask: `url(/client-icons/${asset}.svg) center / contain no-repeat` }} /> :
        <ClientBrandMark preset={preset as "codex" | "claude-code" | "antigravity"} />}
    </span>
  );
}

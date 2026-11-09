import { Monitor } from "lucide-react";
import { clientPreset, CLIENT_PRESETS, type ClientIdentity } from "@/lib/client-identity";
import { cn } from "@/lib/utils";

import { ClientBrandMark } from "./client-brand-mark";

export function ClientAvatar({ client, className }: { client?: ClientIdentity | null; className?: string }) {
  const preset = clientPreset(client);
  const style = CLIENT_PRESETS[preset];
  return (
    <span title={`${style.name} · detected from client name`} aria-label={style.name} data-client-preset={preset}
      className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset", style.color, style.background, className)}>
      {preset === "generic" ? <Monitor aria-hidden="true" className="size-[55%]" strokeWidth={1.8} /> : <ClientBrandMark preset={preset} />}
    </span>
  );
}

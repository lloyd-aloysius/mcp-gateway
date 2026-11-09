"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { format, formatDistanceToNowStrict } from "date-fns";
import { Activity, CheckCircle2, XCircle, ShieldAlert } from "lucide-react";
import { ClientAvatar } from "./client-avatar";
import { clientName, type ClientIdentity } from "@/lib/client-identity";
import { cn } from "@/lib/utils";

export type ActivityEntry = {
  id: string;
  timestamp: number;
  status: "pending" | "success" | "error" | "denied";
  endpointId?: string | null;
  clientId?: string | null;
  endpointName: string;
  toolName: string;
  serverKey?: string | null;
  durationMs?: number;
  error?: string;
};

const STATUS_ICON = {
  pending: Activity,
  success: CheckCircle2,
  error: XCircle,
  denied: ShieldAlert,
};

// Compact rows also fit five entries in the mobile card (previously three).
const ROW_HEIGHT = 60;

const STATUS_STYLE: Record<ActivityEntry["status"], { dot: string; detail: string }> = {
  pending: { dot: "bg-muted-foreground text-background", detail: "text-muted-foreground" },
  success: { dot: "bg-emerald-500 text-background", detail: "text-emerald-500/90" },
  error: { dot: "bg-red-500 text-background", detail: "text-red-500/90" },
  denied: { dot: "bg-amber-500 text-background", detail: "text-amber-500/90" },
};

function detailLine(entry: ActivityEntry): string {
  switch (entry.status) {
    case "pending":
      return "Running…";
    case "success":
      return `Completed in ${entry.durationMs ?? 0}ms`;
    case "denied":
      return "Denied by endpoint access policy";
    case "error":
      return entry.error ? `Failed — ${entry.error}` : "Failed";
  }
}

export function ActivityFeed({ entries, clients = [] }: { entries: ActivityEntry[]; clients?: (ClientIdentity & { endpointId: string })[] }) {
  const listRef = useRef<HTMLUListElement>(null);
  const [capacity, setCapacity] = useState(0);
  const hasEntries = entries.length > 0;

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const observer = new ResizeObserver(([entry]) => {
      setCapacity(Math.floor(entry.contentRect.height / ROW_HEIGHT));
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [hasEntries]);

  if (!hasEntries) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        No activity yet. Tool calls will appear here in real time.
      </div>
    );
  }

  const visible = entries.slice(0, capacity);

  return (
    <ul ref={listRef} aria-labelledby="live-activity-heading" className="relative h-full overflow-clip px-3 py-2">
      <AnimatePresence mode="popLayout" initial={false}>
        {visible.map((entry) => {
          const caller = clients.find((c) => c.endpointId === entry.endpointId && c.clientId === entry.clientId) ?? (entry.clientId ? { clientId: entry.clientId } : null);
          const Icon = STATUS_ICON[entry.status];
          const style = STATUS_STYLE[entry.status];
          const detail = detailLine(entry);
          return (
            <motion.li
              key={entry.id}
              layout="position"
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2 }}
              style={{ height: ROW_HEIGHT }}
              className="flex items-center gap-2.5 border-b border-border/40 last:border-b-0"
            >
              <ClientAvatar client={caller} className="size-7 rounded-lg" />
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <p title={clientName(caller)} className="min-w-0 truncate text-[11px] font-semibold leading-[14px]">
                    {clientName(caller)}
                  </p>
                  <span className="shrink-0 text-[9px] leading-[14px] text-muted-foreground"
                    title={format(entry.timestamp, "MMM d, yyyy 'at' h:mm:ss a")}>
                    {formatDistanceToNowStrict(entry.timestamp, { addSuffix: true })}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate font-mono text-[11px] leading-[14px]" title={entry.toolName}>{entry.toolName}</p>
                  <span title={detail} aria-label={detail} className={cn("inline-flex shrink-0 items-center gap-1 text-[10px] leading-[14px]", style.detail)}>
                    <Icon aria-hidden="true" className={cn("size-3", entry.status === "pending" && "animate-pulse")} />
                    {entry.status === "success" ? `${entry.durationMs ?? 0}ms` : entry.status === "pending" ? "Running" : entry.status === "denied" ? "Denied" : "Failed"}
                  </span>
                </div>
                <p className="truncate text-[10px] leading-[13px] text-muted-foreground" title={`${entry.endpointName} → ${entry.serverKey ?? "Gateway"}`}>
                  {entry.endpointName} <span aria-hidden="true" className="px-0.5 text-muted-foreground/60">→</span> {entry.serverKey ?? "Gateway"}
                </p>
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

"use client";

import { AnimatePresence, motion } from "framer-motion";
import { format, formatDistanceToNowStrict } from "date-fns";
import { Activity, CheckCircle2, XCircle, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type ActivityEntry = {
  id: string;
  timestamp: number;
  status: "pending" | "success" | "error" | "denied";
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
      return `Completed in ${entry.durationMs ?? 0}ms${entry.serverKey ? ` · via ${entry.serverKey}` : ""}`;
    case "denied":
      return "Denied by endpoint access policy";
    case "error":
      return entry.error ? `Failed — ${entry.error}` : "Failed";
  }
}

export function ActivityFeed({ entries, maxVisible = 8 }: { entries: ActivityEntry[]; maxVisible?: number }) {
  const visible = entries.slice(0, maxVisible);

  if (visible.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
        No activity yet. Tool calls will appear here in real time.
      </div>
    );
  }

  return (
    <ul className="flex h-full flex-col overflow-hidden px-4 py-3">
      <AnimatePresence mode="popLayout" initial={false}>
        {visible.map((entry, index) => {
          const Icon = STATUS_ICON[entry.status];
          const style = STATUS_STYLE[entry.status];
          const isLast = index === visible.length - 1;
          return (
            <motion.li
              key={entry.id}
              layout
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 6 }}
              transition={{ duration: 0.2 }}
              className="relative flex gap-3 pb-3 pl-1 last:pb-0"
            >
              {!isLast && (
                <span className="absolute left-[9.5px] top-5 bottom-[-4px] w-px bg-border" />
              )}
              <span
                className={cn(
                  "relative z-10 mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ring-4 ring-card",
                  style.dot
                )}
              >
                <Icon className={cn("size-3", entry.status === "pending" && "animate-pulse")} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 break-words font-mono text-[11px] font-medium leading-snug">
                    {entry.endpointName} <span className="text-muted-foreground">→</span> {entry.toolName}
                  </p>
                  <span
                    className="shrink-0 pt-px font-mono text-[10px] leading-snug text-muted-foreground/60"
                    title={format(entry.timestamp, "MMM d, yyyy 'at' h:mm a")}
                  >
                    {formatDistanceToNowStrict(entry.timestamp, { addSuffix: true })}
                  </span>
                </div>
                <p className={cn("mt-0.5 break-words text-[11px] leading-snug", style.detail)}>
                  {detailLine(entry)}
                </p>
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

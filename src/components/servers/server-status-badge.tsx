import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  connected: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  connecting: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
  error: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  disconnected: "bg-muted text-muted-foreground border-border",
};

export function ServerStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={cn("gap-1.5 font-normal capitalize", STATUS_STYLES[status] ?? STATUS_STYLES.disconnected)}
    >
      <span
        className={cn("size-1.5 rounded-full", {
          "bg-emerald-500": status === "connected",
          "bg-amber-500 animate-pulse": status === "connecting",
          "bg-red-500": status === "error",
          "bg-muted-foreground": status === "disconnected",
        })}
      />
      {status}
    </Badge>
  );
}

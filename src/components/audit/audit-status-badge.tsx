import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STYLES: Record<string, string> = {
  success: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  error: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  denied: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
};

export function AuditStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn("font-normal capitalize", STYLES[status])}>
      {status}
    </Badge>
  );
}

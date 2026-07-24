"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { usePollingFetch } from "@/lib/hooks/use-polling-fetch";
import { useEventStream } from "@/lib/hooks/use-event-stream";
import { formatDistanceToNow } from "date-fns";

type EndpointRow = {
  id: string;
  name: string;
  slug: string;
  tokenPrefix: string;
  defaultPolicy: "allow_all" | "deny_all";
  enabled: boolean;
  lastUsedAt: string | null;
};

export default function EndpointsPage() {
  const { data: endpoints, loading, refetch } = usePollingFetch<EndpointRow[]>("/api/endpoints", 10000);
  const [pendingDelete, setPendingDelete] = useState<EndpointRow | null>(null);

  useEventStream((event) => {
    if (
      event.type === "endpoint.created" ||
      event.type === "endpoint.updated" ||
      event.type === "endpoint.deleted"
    ) {
      void refetch();
    }
  });

  async function toggleEnabled(endpoint: EndpointRow) {
    const res = await fetch(`/api/endpoints/${endpoint.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !endpoint.enabled }),
    });
    if (!res.ok) {
      toast.error("Failed to update endpoint");
      return;
    }
    void refetch();
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const res = await fetch(`/api/endpoints/${pendingDelete.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed to delete endpoint");
    } else {
      toast.success(`Removed "${pendingDelete.name}"`);
    }
    setPendingDelete(null);
    void refetch();
  }

  return (
    <div className="mx-auto max-w-5xl p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Client endpoints</h1>
          <p className="text-sm text-muted-foreground">
            Each endpoint is a unique URL + token a client connects with, with its own access rules.
          </p>
        </div>
        <Button render={<Link href="/endpoints/new" />} nativeButton={false}>
          <Plus className="size-4" />
          New endpoint
        </Button>
      </div>

      {loading && !endpoints ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : endpoints && endpoints.length > 0 ? (
        <div className="space-y-3">
          {endpoints.map((endpoint) => (
            <Card key={endpoint.id}>
              <CardContent className="flex items-center justify-between gap-4 py-2">
                <Link href={`/endpoints/${endpoint.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Plug className="size-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{endpoint.name}</span>
                      <Badge variant="outline" className="font-normal">
                        {endpoint.defaultPolicy === "allow_all" ? "allow by default" : "deny by default"}
                      </Badge>
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      /api/mcp/{endpoint.slug} · {endpoint.tokenPrefix}…
                      {endpoint.lastUsedAt &&
                        ` · last used ${formatDistanceToNow(new Date(endpoint.lastUsedAt), { addSuffix: true })}`}
                    </p>
                  </div>
                </Link>
                <div className="flex shrink-0 items-center gap-3">
                  <Switch checked={endpoint.enabled} onCheckedChange={() => toggleEnabled(endpoint)} />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-red-500"
                    onClick={() => setPendingDelete(endpoint)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-muted-foreground">No client endpoints yet.</p>
            <Button render={<Link href="/endpoints/new" />} nativeButton={false}>
              <Plus className="size-4" />
              Create your first endpoint
            </Button>
          </CardContent>
        </Card>
      )}

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove &ldquo;{pendingDelete?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              Its token stops working immediately. Audit history referencing this endpoint is kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Trash2, Terminal, Globe, Radio, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
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
import { Skeleton } from "@/components/ui/skeleton";
import { usePollingFetch } from "@/lib/hooks/use-polling-fetch";
import { useEventStream } from "@/lib/hooks/use-event-stream";
import { ServerStatusBadge } from "@/components/servers/server-status-badge";
import { ServerFormDialog } from "@/components/servers/server-form-dialog";

type BackendServerRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  connectionType: "stdio" | "http" | "sse";
  command: string | null;
  args: string[] | null;
  url: string | null;
  enabled: boolean;
  status: "connected" | "connecting" | "disconnected" | "error";
  lastError: string | null;
};

const TYPE_ICON = { stdio: Terminal, http: Globe, sse: Radio };

export default function ServersPage() {
  const { data: servers, loading, refetch } = usePollingFetch<BackendServerRow[]>("/api/servers", 8000);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<BackendServerRow | null>(null);
  const [reconnectingAll, setReconnectingAll] = useState(false);

  useEventStream((event) => {
    if (event.type === "server.status_changed") void refetch();
  });

  async function toggleEnabled(server: BackendServerRow) {
    const res = await fetch(`/api/servers/${server.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !server.enabled }),
    });
    if (!res.ok) {
      toast.error("Failed to update server");
      return;
    }
    void refetch();
  }

  async function reconnectAll() {
    setReconnectingAll(true);
    try {
      const res = await fetch("/api/servers/reconnect-all", { method: "POST" });
      if (!res.ok) throw new Error();
      const results: { status: string }[] = await res.json();
      const connected = results.filter((r) => r.status === "connected").length;
      if (connected === results.length) {
        toast.success(`Reconnected ${connected} server${connected === 1 ? "" : "s"}`);
      } else {
        toast.warning(`${connected} of ${results.length} servers reconnected`);
      }
    } catch {
      toast.error("Failed to reconnect servers");
    } finally {
      setReconnectingAll(false);
      void refetch();
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const res = await fetch(`/api/servers/${pendingDelete.id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed to delete server");
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
          <h1 className="text-2xl font-semibold tracking-tight">Backend servers</h1>
          <p className="text-sm text-muted-foreground">
            MCP servers the gateway connects to and aggregates tools from.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={reconnectAll}
            disabled={reconnectingAll || !servers || servers.length === 0}
          >
            <RefreshCw className={reconnectingAll ? "size-4 animate-spin" : "size-4"} />
            Reconnect all
          </Button>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="size-4" />
            Add server
          </Button>
        </div>
      </div>

      {loading && !servers ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : servers && servers.length > 0 ? (
        <div className="space-y-3">
          {servers.map((server) => {
            const Icon = TYPE_ICON[server.connectionType];
            return (
              <Card key={server.id}>
                <CardContent className="flex items-center justify-between gap-4 py-2">
                  <Link
                    href={`/servers/${server.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
                      <Icon className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{server.name}</span>
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          {server.key}
                        </code>
                      </div>
                      <p className="truncate text-sm text-muted-foreground">
                        {server.connectionType === "stdio"
                          ? `${server.command} ${(server.args ?? []).join(" ")}`
                          : server.url}
                      </p>
                      {server.status === "error" && server.lastError && (
                        <p className="truncate text-xs text-red-500">{server.lastError}</p>
                      )}
                    </div>
                  </Link>
                  <div className="flex shrink-0 items-center gap-3">
                    <ServerStatusBadge status={server.status} />
                    <Switch checked={server.enabled} onCheckedChange={() => toggleEnabled(server)} />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-red-500"
                      onClick={() => setPendingDelete(server)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-muted-foreground">No backend servers yet.</p>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" />
              Add your first server
            </Button>
          </CardContent>
        </Card>
      )}

      <ServerFormDialog open={dialogOpen} onOpenChange={setDialogOpen} onSaved={refetch} />

      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove &ldquo;{pendingDelete?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This stops the connection and removes it from every endpoint&apos;s access rules. Audit
              history referencing this server is kept.
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

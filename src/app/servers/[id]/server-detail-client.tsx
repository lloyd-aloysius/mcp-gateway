"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Trash2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { KeyValueListEditor } from "@/components/servers/key-value-list-editor";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { ServerStatusBadge } from "@/components/servers/server-status-badge";

type BackendServer = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  connectionType: "stdio" | "http" | "sse";
  command: string | null;
  args: string[] | null;
  env: Record<string, string> | null;
  url: string | null;
  headers: Record<string, string> | null;
  enabled: boolean;
  status: "connected" | "connecting" | "disconnected" | "error";
  lastError: string | null;
  lastConnectedAt: string | null;
  pid: number | null;
};

type ToolRow = { name: string; description: string | null; enabled: boolean };

export function ServerDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const [server, setServer] = useState<BackendServer | null>(null);
  const [tools, setTools] = useState<ToolRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState<Record<string, string>>({});
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState<Record<string, string>>({});

  async function loadAll() {
    const [serverRes, toolsRes] = await Promise.all([
      fetch(`/api/servers/${id}`),
      fetch(`/api/servers/${id}/tools`),
    ]);
    if (serverRes.ok) {
      const s = await serverRes.json();
      setServer(s);
      setName(s.name);
      setDescription(s.description ?? "");
      setCommand(s.command ?? "");
      setArgs((s.args ?? []).join("\n"));
      setEnv(s.env ?? {});
      setUrl(s.url ?? "");
      setHeaders(s.headers ?? {});
    }
    if (toolsRes.ok) setTools(await toolsRes.json());
    setLoading(false);
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function saveSettings(patch: Record<string, unknown>) {
    const res = await fetch(`/api/servers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error && typeof data.error === "string" ? data.error : "Failed to save");
      return;
    }
    await loadAll();
    toast.success("Saved");
  }

  async function toggleTool(toolName: string, enabled: boolean) {
    setTools((prev) => prev.map((t) => (t.name === toolName ? { ...t, enabled } : t)));
    const res = await fetch(`/api/servers/${id}/tools`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolName, enabled }),
    });
    if (!res.ok) {
      setTools((prev) => prev.map((t) => (t.name === toolName ? { ...t, enabled: !enabled } : t)));
      toast.error("Failed to update tool");
    }
  }

  async function reconnect() {
    setReconnecting(true);
    try {
      const res = await fetch(`/api/servers/${id}/reconnect`, { method: "POST" });
      if (!res.ok) throw new Error();
      toast.success("Reconnecting…");
      await loadAll();
    } catch {
      toast.error("Failed to reconnect");
    } finally {
      setReconnecting(false);
    }
  }

  async function confirmDelete() {
    const res = await fetch(`/api/servers/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed to delete server");
      return;
    }
    toast.success("Server removed");
    router.push("/servers");
  }

  if (loading || !server) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-60 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <Link
        href="/servers"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to servers
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{server.name}</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Enabled</span>
          <Switch checked={server.enabled} onCheckedChange={(v) => saveSettings({ enabled: v })} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => name !== server.name && saveSettings({ name })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => description !== (server.description ?? "") && saveSettings({ description })}
              />
            </div>
          </div>

          {server.connectionType === "stdio" ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Command</Label>
                  <Input
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    onBlur={() => command !== (server.command ?? "") && saveSettings({ command })}
                    className="font-mono text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Arguments (one per line)</Label>
                  <Textarea
                    value={args}
                    onChange={(e) => setArgs(e.target.value)}
                    onBlur={() => {
                      const next = args ? args.split("\n").map((s) => s.trim()).filter(Boolean) : [];
                      const prev = server.args ?? [];
                      if (JSON.stringify(next) !== JSON.stringify(prev)) saveSettings({ args: next });
                    }}
                    className="font-mono text-sm"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Environment variables</Label>
                <KeyValueListEditor
                  value={env}
                  onChange={setEnv}
                  onCommit={(v) => saveSettings({ env: v })}
                  keyPlaceholder="API_KEY"
                  valuePlaceholder="value"
                  addLabel="Add variable"
                  emptyLabel="No environment variables set"
                />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>URL</Label>
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onBlur={() => url !== (server.url ?? "") && saveSettings({ url })}
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Headers</Label>
                <KeyValueListEditor
                  value={headers}
                  onChange={setHeaders}
                  onCommit={(v) => saveSettings({ headers: v })}
                  keyPlaceholder="Authorization"
                  valuePlaceholder="Bearer ..."
                  addLabel="Add header"
                  emptyLabel="No headers set"
                />
              </div>
            </>
          )}
          <p className="text-xs text-muted-foreground">
            Connection type ({server.connectionType}) can&apos;t be changed after creation.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tools</CardTitle>
          <CardDescription>
            Disabling a tool hides it from every endpoint&apos;s tool list and blocks calls to it,
            regardless of that endpoint&apos;s access policy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tools.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No tools available — the server may be disconnected.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table className="table-fixed">
                <TableHeader>
                  <TableRow>
                    <TableHead>Tool</TableHead>
                    <TableHead className="w-20 shrink-0 text-right">Enabled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tools.map((tool) => (
                    <TableRow key={tool.name}>
                      <TableCell className="max-w-0 whitespace-normal">
                        <span className="block break-words font-mono text-sm">{tool.name}</span>
                        {tool.description && (
                          <p className="break-words text-xs text-muted-foreground">
                            {tool.description}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="w-20 shrink-0 text-right">
                        <Switch
                          checked={tool.enabled}
                          onCheckedChange={(v) => toggleTool(tool.name, v)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <ServerStatusBadge status={server.status} />
            {server.pid !== null && <span className="text-sm text-muted-foreground">PID {server.pid}</span>}
          </div>
          {server.status === "error" && server.lastError && (
            <p className="text-sm text-red-500">{server.lastError}</p>
          )}
          <Button variant="outline" size="sm" onClick={reconnect} disabled={reconnecting}>
            <RefreshCw className={reconnecting ? "size-3.5 animate-spin" : "size-3.5"} />
            Reconnect
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>
            Stops the connection and removes it from every endpoint&apos;s access rules. Audit history
            referencing this server is kept.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="size-4" />
            Delete server
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{server.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>This can&apos;t be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

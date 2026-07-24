"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { format, formatDistanceToNowStrict } from "date-fns";
import { ArrowLeft, Trash2, Copy, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { CopyConfigPanel } from "@/components/endpoints/copy-config-panel";
import { RuleToggleTable } from "@/components/endpoints/rule-toggle-table";

type Endpoint = {
  id: string;
  name: string;
  slug: string;
  tokenPrefix: string;
  defaultPolicy: "allow_all" | "deny_all";
  enabled: boolean;
};

type BackendServerRow = { id: string; key: string; name: string; status: string };
type Rule = { backendServerId: string; access: "allow" | "deny" };
type EndpointClientRow = { id: string; clientId: string; label: string | null; firstSeenAt: string; lastSeenAt: string };

export function EndpointDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const [endpoint, setEndpoint] = useState<Endpoint | null>(null);
  const [servers, setServers] = useState<BackendServerRow[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [clients, setClients] = useState<EndpointClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [expandedClientId, setExpandedClientId] = useState<string | null>(null);
  const [createClientOpen, setCreateClientOpen] = useState(false);
  const [newClientId, setNewClientId] = useState("");
  const [creatingClient, setCreatingClient] = useState(false);

  async function loadAll() {
    const [epRes, serversRes, rulesRes, clientsRes] = await Promise.all([
      fetch(`/api/endpoints/${id}`),
      fetch("/api/servers"),
      fetch(`/api/endpoints/${id}/rules`),
      fetch(`/api/endpoints/${id}/clients`),
    ]);
    if (epRes.ok) {
      const ep = await epRes.json();
      setEndpoint(ep);
      setName(ep.name);
      setSlug(ep.slug);
    }
    if (serversRes.ok) setServers(await serversRes.json());
    if (rulesRes.ok) setRules(await rulesRes.json());
    if (clientsRes.ok) setClients(await clientsRes.json());
    setLoading(false);
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function saveSettings(patch: Partial<Pick<Endpoint, "name" | "slug" | "defaultPolicy" | "enabled">>) {
    const res = await fetch(`/api/endpoints/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      toast.error(data?.error && typeof data.error === "string" ? data.error : "Failed to save");
      return;
    }
    const updated = await res.json();
    setEndpoint(updated);
    toast.success("Saved");
  }

  async function createClient() {
    const clientId = newClientId.trim();
    if (!clientId) return;
    setCreatingClient(true);
    try {
      const res = await fetch(`/api/endpoints/${id}/clients`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error && typeof data.error === "string" ? data.error : "Failed to create client");
        return;
      }
      const created = await res.json();
      setClients((prev) => [created, ...prev]);
      toast.success("Client created");
      setNewClientId("");
      setCreateClientOpen(false);
    } finally {
      setCreatingClient(false);
    }
  }

  async function confirmDelete() {
    const res = await fetch(`/api/endpoints/${id}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error("Failed to delete endpoint");
      return;
    }
    toast.success("Endpoint removed");
    router.push("/endpoints");
  }

  if (loading || !endpoint) {
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
        href="/endpoints"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to endpoints
      </Link>

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">{endpoint.name}</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Enabled</span>
          <Switch
            checked={endpoint.enabled}
            onCheckedChange={(v) => saveSettings({ enabled: v })}
          />
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
                onBlur={() => name !== endpoint.name && saveSettings({ name })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Slug</Label>
              <Input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                onBlur={() => slug !== endpoint.slug && saveSettings({ slug })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Default access policy</Label>
            <Select
              items={{ deny_all: "Deny everything, then grant", allow_all: "Allow everything, then restrict" }}
              value={endpoint.defaultPolicy}
              onValueChange={(v) => saveSettings({ defaultPolicy: v as "allow_all" | "deny_all" })}
            >
              <SelectTrigger className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="deny_all">Deny everything, then grant</SelectItem>
                <SelectItem value="allow_all">Allow everything, then restrict</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Server access</CardTitle>
          <CardDescription>
            Overrides the default policy above on a per-server basis. Changes apply to the client&apos;s
            next call — no restart needed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RuleToggleTable
            endpointId={id}
            servers={servers}
            initialRules={rules}
            defaultPolicy={endpoint.defaultPolicy}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Connected clients</CardTitle>
            <CardDescription>
              Distinct clients that have connected to this endpoint, identified by the{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">X-MCP-Client-Id</code> header (or
              a random id if the client didn&apos;t send one).
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setCreateClientOpen(true)} className="shrink-0">
            <Plus className="size-3.5" />
            Create a client
          </Button>
        </CardHeader>
        <CardContent>
          {clients.length === 0 ? (
            <p className="text-sm text-muted-foreground">No clients have connected yet.</p>
          ) : (
            <div className="space-y-2">
              {clients.map((client) => (
                <div key={client.id} className="rounded-lg border">
                  <div className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm">{client.label ?? client.clientId}</p>
                      <p
                        className="text-xs text-muted-foreground"
                        title={format(new Date(client.lastSeenAt), "MMM d, yyyy 'at' h:mm a")}
                      >
                        Last seen {formatDistanceToNowStrict(new Date(client.lastSeenAt), { addSuffix: true })}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setExpandedClientId((prev) => (prev === client.clientId ? null : client.clientId))
                      }
                    >
                      <Copy className="size-3.5" />
                      Copy config
                    </Button>
                  </div>
                  {expandedClientId === client.clientId && (
                    <div className="border-t p-3">
                      <CopyConfigPanel
                        endpointId={id}
                        slug={endpoint.slug}
                        tokenPrefix={endpoint.tokenPrefix}
                        revealedToken={revealedToken}
                        onTokenRegenerated={setRevealedToken}
                        clientIdHeader={client.clientId}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Client configuration</CardTitle>
          <CardDescription>Paste this into your MCP client to connect to this endpoint.</CardDescription>
        </CardHeader>
        <CardContent>
          <CopyConfigPanel
            endpointId={id}
            slug={endpoint.slug}
            tokenPrefix={endpoint.tokenPrefix}
            revealedToken={revealedToken}
            onTokenRegenerated={setRevealedToken}
          />
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>Deletes this endpoint and revokes its token immediately.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="size-4" />
            Delete endpoint
          </Button>
        </CardContent>
      </Card>

      <Dialog open={createClientOpen} onOpenChange={setCreateClientOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a client</DialogTitle>
            <DialogDescription>
              Pre-register a client for this endpoint before it ever connects — useful for generating
              its config ahead of time. This becomes the value sent as{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">X-MCP-Client-Id</code>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>Client name or ID</Label>
            <Input
              placeholder="e.g. Claude Code, MacBook Pro"
              value={newClientId}
              onChange={(e) => setNewClientId(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createClient()}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateClientOpen(false)}>
              Cancel
            </Button>
            <Button onClick={createClient} disabled={!newClientId.trim() || creatingClient}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{endpoint.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This can&apos;t be undone. The endpoint&apos;s token stops working immediately.
            </AlertDialogDescription>
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

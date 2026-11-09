"use client";

import { useState } from "react";
import { toast } from "sonner";
import { ClientAvatar } from "@/components/flow/client-avatar";
import { clientPreset, CLIENT_PRESETS } from "@/lib/client-identity";
import { usePollingFetch } from "@/lib/hooks/use-polling-fetch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Client = { id: string; endpointId: string; clientId: string; label: string | null };

function ClientSetting({ client, endpoint, onSaved }: { client: Client; endpoint: string; onSaved: () => void }) {
  const [name, setName] = useState(client.label ?? "");
  const [saving, setSaving] = useState(false);
  const preview = { clientId: client.clientId, label: name };
  const changed = name.trim() !== (client.label ?? "");
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch("/api/endpoints/clients", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: client.id, label: name.trim() || null }),
      });
      if (!response.ok) throw new Error("Could not save client name");
      const saved: Client = await response.json();
      setName(saved.label ?? "");
      onSaved();
      toast.success("Client name updated");
    } catch { toast.error("Could not save client name. Please try again."); }
    finally { setSaving(false); }
  }
  return (
    <form onSubmit={save} className="flex items-start gap-3 rounded-xl border p-3">
      <ClientAvatar client={preview} className="mt-0.5 size-10" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2">
          <Input aria-label={`Client name for ${client.clientId} on ${endpoint}`} placeholder={client.clientId} value={name}
            maxLength={120} disabled={saving} onChange={(event) => setName(event.target.value)} />
          <Button type="submit" size="sm" variant="outline" disabled={saving || !changed}>{saving ? "Saving…" : "Save"}</Button>
        </div>
        <p className="text-xs text-muted-foreground">{endpoint} · {CLIENT_PRESETS[clientPreset(preview)].name} icon</p>
        <p className="truncate font-mono text-[10px] text-muted-foreground" title={client.clientId}>ID: {client.clientId}</p>
      </div>
    </form>
  );
}

export function ClientSettings() {
  const { data: clients, error, refetch } = usePollingFetch<Client[]>("/api/endpoints/clients", 10000);
  const { data: endpoints } = usePollingFetch<{ id: string; name: string }[]>("/api/endpoints", 10000);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Clients</CardTitle>
        <CardDescription>Name your clients here. Codex, Claude Code and Antigravity icons are detected automatically; other names use a generic icon. Leave the name empty to use the client ID.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <p className="text-sm text-destructive">Could not load clients.</p> : !clients ? <p className="text-sm text-muted-foreground">Loading clients…</p> : clients.length === 0 ? <p className="text-sm text-muted-foreground">No clients yet. Connect a client or create one from an endpoint.</p> :
          clients.map((client) => <ClientSetting key={`${client.id}:${client.label ?? ""}`} client={client}
            endpoint={endpoints?.find((endpoint) => endpoint.id === client.endpointId)?.name ?? "Endpoint"} onSaved={() => { void refetch(); }} />)}
      </CardContent>
    </Card>
  );
}

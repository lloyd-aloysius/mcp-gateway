"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ClientAvatar } from "@/components/flow/client-avatar";
import { ClientActions, ClientEditor, type ClientProfile } from "@/components/clients/client-editor";
import { clientName, clientPreset, CLIENT_PRESETS } from "@/lib/client-identity";
import { usePollingFetch } from "@/lib/hooks/use-polling-fetch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export function ClientSettings() {
  const { data: clients, error, refetch } = usePollingFetch<ClientProfile[]>("/api/endpoints/clients", 10000);
  const { data: endpoints } = usePollingFetch<{ id: string; name: string }[]>("/api/endpoints", 10000);
  const [creating, setCreating] = useState(false);
  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex items-center justify-between gap-3"><CardTitle>Clients</CardTitle><Button size="sm" variant="outline" disabled={!endpoints?.length} onClick={() => setCreating(true)}><Plus className="size-3.5" />Create a client</Button></div>
        <CardDescription>Choose a name and logo for each client, or let the name select one automatically. Remove accidental profiles here; future calls discover them again.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {error ? <p className="text-sm text-destructive">Could not load clients.</p> : !clients ? <p className="text-sm text-muted-foreground">Loading clients…</p> : clients.length === 0 ? <p className="text-sm text-muted-foreground">No clients yet. Create a client or connect one to an endpoint.</p> : clients.map((client) => <div key={client.id} className="flex items-center gap-3 rounded-xl border p-3">
          <ClientAvatar client={client} className="size-10" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold" title={clientName(client)}>{clientName(client)}</p>
            <p className="truncate text-[11px] text-muted-foreground"><Link href={`/endpoints/${client.endpointId}`} className="hover:underline">{endpoints?.find((e) => e.id === client.endpointId)?.name ?? "Endpoint"}</Link> · {CLIENT_PRESETS[clientPreset(client)].name}</p>
            <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground" title={client.clientId}>ID: {client.clientId}</p>
          </div>
          <div className="flex shrink-0 gap-1"><ClientActions client={client} onSaved={refetch} /></div>
        </div>)}
      </CardContent>
      {creating && <ClientEditor endpoints={endpoints ?? []} onClose={() => setCreating(false)} onSaved={refetch} />}
    </Card>
  );
}

"use client";

import { useId, useState } from "react";
import { Pencil, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ClientAvatar } from "@/components/flow/client-avatar";
import { CLIENT_ICON_IDS, CLIENT_PRESETS, clientName, type ClientIdentity, type ClientIconSelection } from "@/lib/client-identity";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

export type ClientProfile = ClientIdentity & { id: string; endpointId: string; lastSeenAt?: string };
type Endpoint = { id: string; name: string };

export function ClientEditor({ client, endpointId: fixedEndpoint, endpoints = [], onClose, onSaved }: {
  client?: ClientProfile; endpointId?: string; endpoints?: Endpoint[]; onClose: () => void; onSaved: () => void | Promise<void>;
}) {
  const uid = useId();
  const [name, setName] = useState(client?.label ?? "");
  const [clientId, setClientId] = useState(client?.clientId ?? "");
  const [endpointId, setEndpointId] = useState(client?.endpointId ?? fixedEndpoint ?? (endpoints.length === 1 ? endpoints[0].id : ""));
  const [icon, setIcon] = useState<ClientIconSelection>(CLIENT_ICON_IDS.includes(client?.icon as ClientIconSelection) ? client!.icon as ClientIconSelection : "auto");
  const [busy, setBusy] = useState(false);
  const preview = { clientId: clientId || "New client", label: name, icon };
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(client ? "/api/endpoints/clients" : `/api/endpoints/${endpointId}/clients`, {
        method: client ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(client ? { id: client.id, label: name.trim() || null, icon } : { clientId: clientId.trim(), label: name.trim() || null, icon }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(typeof data?.error === "string" ? data.error : "Could not save client");
      }
      await onSaved();
      onClose();
      toast.success(client ? "Client updated" : "Client created");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save client"); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{client ? "Edit client" : "Create a client"}</DialogTitle>
          <DialogDescription>{client ? "Change the display name and logo. The connection ID and endpoint credentials stay the same." : "Register a client before it connects, then use its ID in the endpoint's client configuration."}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-5">
          <fieldset disabled={busy} className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl border bg-muted/20 p-3">
              <ClientAvatar client={preview} className="size-11" />
              <div className="min-w-0"><p className="truncate text-sm font-semibold" title={clientName(preview)}>{clientName(preview)}</p><p className="text-xs text-muted-foreground">{icon === "auto" ? "Logo detected automatically" : "Selected logo"}</p></div>
            </div>
            {!client && !fixedEndpoint && <div className="space-y-1.5">
              <Label htmlFor={uid + "-endpoint"}>Endpoint</Label>
              <select id={uid + "-endpoint"} required value={endpointId} onChange={(e) => setEndpointId(e.target.value)} className="h-9 w-full rounded-lg border bg-background px-3 text-sm">
                <option value="">Choose an endpoint</option>{endpoints.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>}
            <div className="space-y-1.5">
              <Label htmlFor={uid + "-name"}>Display name</Label>
              <Input id={uid + "-name"} value={name} maxLength={120} placeholder={clientId || "e.g. Hermes on my Mac"} onChange={(e) => setName(e.target.value)} autoFocus />
              <p className="text-[11px] text-muted-foreground">Leave empty to display the client ID.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={uid + "-id"}>Client ID</Label>
              {client ? <code id={uid + "-id"} className="block truncate rounded-lg bg-muted px-3 py-2 text-xs" title={clientId}>{clientId}</code> :
                <Input id={uid + "-id"} required value={clientId} maxLength={128} placeholder="e.g. hermes-mac" onChange={(e) => setClientId(e.target.value)} />}
            </div>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium">Logo</legend>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {CLIENT_ICON_IDS.map((value) => <label key={value} className={cn("relative flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border px-1 py-2 transition-colors has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring", value === icon ? "border-primary bg-primary/5" : "hover:bg-muted/50")}>
                  <input type="radio" name={uid + "-logo"} value={value} checked={icon === value} onChange={() => setIcon(value)} className="sr-only" />
                  {value === "auto" ? <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Sparkles className="size-4" /></span> : <ClientAvatar client={{ clientId, label: name, icon: value }} className="size-8 rounded-lg" />}
                  <span className="text-center text-[10px] font-medium leading-tight">{value === "auto" ? "Automatic" : CLIENT_PRESETS[value].name}</span>
                </label>)}
              </div>
            </fieldset>
          </fieldset>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !clientId.trim() || !endpointId}>{busy ? "Saving…" : client ? "Save changes" : "Create client"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ClientActions({ client, onSaved }: { client: ClientProfile; onSaved: () => void | Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      const response = await fetch("/api/endpoints/clients", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: client.id }) });
      if (!response.ok) throw new Error("Could not remove client");
      await onSaved();
      setRemoving(false);
      toast.success("Client profile removed");
    } catch { toast.error("Could not remove client. Please try again."); }
    finally { setBusy(false); }
  }
  return <>
    <Button variant="outline" size="icon-sm" aria-label={`Edit ${clientName(client)}`} title="Edit client" onClick={() => setEditing(true)}><Pencil className="size-3.5" /></Button>
    <Button variant="ghost" size="icon-sm" aria-label={`Remove ${clientName(client)}`} title="Remove client" className="text-muted-foreground hover:text-destructive" onClick={() => setRemoving(true)}><Trash2 className="size-3.5" /></Button>
    {editing && <ClientEditor client={client} onSaved={onSaved} onClose={() => setEditing(false)} />}
    <Dialog open={removing} onOpenChange={(open) => { if (!busy) setRemoving(open); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {clientName(client)}?</DialogTitle>
          <DialogDescription>This forgets the saved client profile. Audit history, endpoint credentials and access rules are kept. The client will be discovered again when it makes another call.</DialogDescription>
        </DialogHeader>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setRemoving(false)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={remove}>{busy ? "Removing…" : "Remove profile"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

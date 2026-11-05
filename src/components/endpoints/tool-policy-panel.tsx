"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Mode = "inherit" | "allowlist";
type Access = "inherit" | "allow" | "deny";
type Tool = { name: string; access: Access; effective: "allow" | "deny"; reason: string };

export function ToolPolicyPanel({ endpointId, servers }: {
  endpointId: string;
  servers: { id: string; name: string }[];
}) {
  const [backend, setBackend] = useState("");
  const [preview, setPreview] = useState<{ tools: Tool[]; partial: boolean; mode: Mode } | null>(null);
  const [busy, setBusy] = useState(false);
  const path = `/api/endpoints/${endpointId}/tool-policy`;

  async function load(id: string, change?: { toolName: string; access: Access } | { mode: Mode }) {
    setBusy(true);
    try {
      if (change) {
        const saved = await fetch(path, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ backendServerId: id, ...change }),
        });
        if (!saved.ok) throw new Error("Could not save tool rule");
      }
      const response = await fetch(`${path}?backendServerId=${encodeURIComponent(id)}`);
      if (!response.ok) throw new Error("Could not load tool policy");
      setPreview(await response.json());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load tool policy");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tool policy preview</CardTitle>
        <CardDescription>Check which tools the selected endpoint can call. Use allowlist mode to grant only the tools you have selected.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex flex-col gap-1 text-sm">
          Backend
          <select className="rounded-md border bg-background p-2" value={backend} disabled={busy} onChange={(event) => {
            const id = event.target.value;
            setBackend(id);
            setPreview(null);
            if (id) void load(id);
          }}>
            <option value="">Choose a backend</option>
            {servers.map(({ id, name }) => <option value={id} key={id}>{name}</option>)}
          </select>
        </label>
        {preview && (
          <label className="flex flex-col gap-1 text-sm">
            Tool policy mode
            <select className="rounded-md border bg-background p-2" disabled={busy} value={preview.mode}
              onChange={(event) => void load(backend, { mode: event.target.value as Mode })}>
              <option value="inherit">Inherit backend access</option>
              <option value="allowlist">Allowlist only</option>
            </select>
          </label>
        )}
        {preview?.partial && <p className="text-sm text-muted-foreground">The backend returned an incomplete inventory.</p>}
        {preview?.tools.length === 0 && <p className="text-sm text-muted-foreground">No tools were found.</p>}
        {preview?.tools.map((tool) => (
          <div key={tool.name} className="flex items-center justify-between gap-2 border-t py-2 text-sm">
            <div className="min-w-0">
              <p className="break-all font-mono">{tool.name}</p>
              <p className="text-muted-foreground">{tool.effective === "allow" ? "Allowed" : tool.reason}</p>
            </div>
            <select className="rounded-md border bg-background p-2" aria-label={`Rule for ${tool.name}`}
              disabled={busy} value={tool.access}
              onChange={(event) => void load(backend, { toolName: tool.name, access: event.target.value as Access })}>
              <option value="inherit">Inherit</option>
              <option value="allow">Allow</option>
              <option value="deny">Deny</option>
            </select>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

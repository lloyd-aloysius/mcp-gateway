"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type Health = {
  ready: boolean;
  backends: { key: string; status: string }[];
  activeSessions: number;
  auditRetentionDays: number | null;
  auditMaxRows: number | null;
  toolCallsLastHour: { status: string; count: number; averageMs: number | null }[];
};
type Change = { key: string; action: string; enabled: boolean };

export function GatewayOperations() {
  const [health, setHealth] = useState<Health | null>(null);
  const [config, setConfig] = useState("");
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function checkHealth() {
    try {
      const response = await fetch("/api/settings/health");
      if (!response.ok && response.status !== 503) throw new Error();
      setHealth(await response.json());
    } catch {
      toast.error("Could not read gateway health");
    }
  }

  async function importConfig(apply: boolean) {
    setBusy(true);
    try {
      const response = await fetch("/api/settings/config" + (apply ? "?apply=1" : ""), {
        method: "POST", headers: { "content-type": "application/json" }, body: config,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Configuration import failed");
      setChanges(apply ? null : result.changes);
      if (apply) toast.success("Backend configuration applied");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Configuration import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader><CardTitle>Gateway health</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Button variant="outline" onClick={checkHealth}>Check connectivity</Button>
          {health && (
            <div className="space-y-1 text-sm">
              <p>{health.ready ? "Ready" : "Some backends are unavailable"} · {health.activeSessions} active sessions</p>
              {health.backends.map(({ key, status }) => <p key={key}>{key} · {status}</p>)}
              <p>Audit retention · {health.auditRetentionDays === null ? "No age limit" : `${health.auditRetentionDays} days`}
                {health.auditMaxRows !== null && ` · ${health.auditMaxRows.toLocaleString()} rows`}
              </p>
              {health.toolCallsLastHour.map(({ status, count, averageMs }) => (
                <p key={status}>Last hour · {count} {status} · {Math.round(averageMs ?? 0)} ms average</p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Backend configuration</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <a href="/api/settings/config" className="text-sm underline">Download backend configuration</a>
          <Textarea value={config} aria-label="Backend configuration JSON" placeholder='{"version":1,"backends":[]}'
            onChange={(event) => { setConfig(event.target.value); setChanges(null); }} disabled={busy} />
          <div className="flex gap-2">
            <Button variant="outline" disabled={busy || !config.trim()} onClick={() => importConfig(false)}>Preview import</Button>
            {changes && <Button disabled={busy || changes.length === 0} onClick={() => importConfig(true)}>Apply import</Button>}
          </div>
          {changes?.map(({ key, action, enabled }) => <p className="text-sm" key={key}>{action} · {key} · {enabled ? "enabled" : "disabled"}</p>)}
        </CardContent>
      </Card>
    </>
  );
}

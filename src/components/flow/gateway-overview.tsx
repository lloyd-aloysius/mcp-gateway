"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Network } from "lucide-react";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePollingFetch } from "@/lib/hooks/use-polling-fetch";
import { useEventStream, type GatewayEvent } from "@/lib/hooks/use-event-stream";
import { GatewayFlow, type PulseState } from "@/components/flow/gateway-flow";
import { ActivityFeed, type ActivityEntry } from "@/components/flow/activity-feed";
import { PULSE_TRAVEL_MS } from "@/components/flow/pulse-edge";

type BackendServerRow = {
  id: string;
  name: string;
  description?: string | null;
  connectionType: "stdio" | "http" | "sse";
  command?: string | null;
  args?: string[] | null;
  url?: string | null;
  enabled: boolean;
  status: string;
  lastConnectedAt: string | null;
  lastError?: string | null;
  pid?: number | null;
};

type EndpointRow = {
  id: string;
  name: string;
  slug?: string;
  enabled: boolean;
  defaultPolicy?: "allow_all" | "deny_all";
  lastUsedAt: string | null;
  createdAt?: string;
  activeSessions: number;
};

type EndpointClientRow = {
  endpointId: string;
  clientId: string;
  label: string | null;
  icon?: string;
  lastSeenAt: string;
};

type AuditRow = {
  id: number;
  timestamp: string;
  endpointId: string | null;
  clientId: string | null;
  endpointNameSnapshot: string | null;
  backendServerKeySnapshot: string | null;
  itemName: string | null;
  status: "success" | "error" | "denied";
  durationMs: number | null;
  errorMessage: string | null;
};

const PULSE_CLEAR_MS = 1500;
const MIN_PULSE_MS = PULSE_TRAVEL_MS + 100; // Allow the browser time to paint the first frame.
const MAX_ACTIVITY_ENTRIES = 50;

function shortToolName(itemName: string | null) {
  if (!itemName) return null;
  const idx = itemName.indexOf("__");
  return idx === -1 ? itemName : itemName.slice(idx + 2);
}

type ViewerSnapshot = { servers: BackendServerRow[]; endpoints: EndpointRow[]; clients: EndpointClientRow[]; rows: AuditRow[] };

export function GatewayOverview({ viewer = false }: { viewer?: boolean }) {
  const { data: adminServers, refetch: refetchServers } =
    usePollingFetch<BackendServerRow[]>(viewer ? null : "/api/servers", 8000);
  const { data: adminEndpoints, refetch: refetchEndpoints } =
    usePollingFetch<EndpointRow[]>(viewer ? null : "/api/endpoints", 10000);
  const { data: adminClients, refetch: refetchClients } =
    usePollingFetch<EndpointClientRow[]>(viewer ? null : "/api/endpoints/clients", 10000);

  const { data: snapshot, refetch: refetchSnapshot, error: snapshotError } = usePollingFetch<ViewerSnapshot>(viewer ? "/api/viewer/snapshot" : null, 8000);
  const servers = viewer ? snapshot?.servers : adminServers;
  const endpoints = viewer ? snapshot?.endpoints : adminEndpoints;
  const clients = viewer ? snapshot?.clients : adminClients;

  const [pulses, setPulses] = useState<PulseState>({});
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const pendingCalls = useRef<
    Map<
      string,
      {
        clientId: string | null;
        edgeKeys: string[];
        label: string;
        startedAt: number;
      }
    >
  >(new Map());
  // A call owns its edges until it finishes and has had time for a full particle pass.
  const activeCallsByEdge = useRef<Map<string, Set<string>>>(new Map());
  const finishTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const clearTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const finishing = finishTimers.current;
    const clearing = clearTimers.current;
    return () => {
      finishing.forEach((timer) => clearTimeout(timer));
      clearing.forEach((timer) => clearTimeout(timer));
      finishing.clear();
      clearing.clear();
    };
  }, []);

  const setEdgePulse = useCallback(
    (key: string, status: PulseState[string]["status"], label?: string) => {
      setPulses((prev) => ({ ...prev, [key]: { status, label } }));
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    fetch(viewer ? "/api/viewer/snapshot" : "/api/audit?operationType=tools%2Fcall", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ rows: AuditRow[] }>) : null))
      .then((data) => {
        if (cancelled || !data) return;
        const seeded: ActivityEntry[] = data.rows
          .map((row) => ({
            id: `audit-${row.id}`,
            endpointId: row.endpointId,
            clientId: row.clientId,
            timestamp: new Date(row.timestamp).getTime(),
            status: row.status,
            endpointName: row.endpointNameSnapshot ?? "Unknown endpoint",
            toolName: shortToolName(row.itemName) ?? "call",
            serverKey: row.backendServerKeySnapshot,
            durationMs: row.durationMs ?? undefined,
            error: row.errorMessage ?? undefined,
          }))
          .slice(0, MAX_ACTIVITY_ENTRIES);
        setActivity(seeded);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [viewer]);

  const handleEvent = useCallback(
    (event: GatewayEvent) => {
      if (viewer && (event.type === "client.changed" || event.type === "server.status_changed" || event.type.startsWith("endpoint."))) {
        void refetchSnapshot();
        return;
      }
      if (event.type === "client.changed") {
        void refetchClients();
        return;
      }
      if (event.type === "server.status_changed" || event.type.startsWith("endpoint.")) {
        void refetchServers();
        void refetchEndpoints();
        return;
      }

      if (event.type === "call.started") {
        const label = shortToolName(event.itemName) ?? event.operationType;
        const edgeKeys = [
          event.backendServerId ? `server-${event.backendServerId}` : null,
          `endpoint-${event.endpointId}`,
          event.clientId ? `client-${event.endpointId}-${event.clientId}` : null,
        ].filter((k): k is string => !!k);
        pendingCalls.current.set(event.callId, {
          clientId: event.clientId, edgeKeys, label, startedAt: performance.now(),
        });

        for (const key of edgeKeys) {
          let set = activeCallsByEdge.current.get(key);
          if (!set) {
            set = new Set();
            activeCallsByEdge.current.set(key, set);
          }
          set.add(event.callId);

          const existingTimer = clearTimers.current.get(key);
          if (existingTimer) {
            clearTimeout(existingTimer);
            clearTimers.current.delete(key);
          }
          setEdgePulse(key, "active", label);
        }

        setActivity((prev) => [
          {
            id: event.callId,
            endpointId: event.endpointId,
            clientId: event.clientId,
            timestamp: Date.now(),
            status: "pending" as const,
            endpointName: event.endpointName,
            toolName: label,
            serverKey: event.backendServerKey,
          },
          ...prev,
        ].slice(0, MAX_ACTIVITY_ENTRIES));
        return;
      }

      if (event.type === "call.finished") {
        const call = pendingCalls.current.get(event.callId);
        pendingCalls.current.delete(event.callId);
        if (!call) return;

        const finishPulse = () => {
          finishTimers.current.delete(event.callId);
          for (const key of call.edgeKeys) {
            const calls = activeCallsByEdge.current.get(key);
            calls?.delete(event.callId);
            if (calls?.size) continue;
            activeCallsByEdge.current.delete(key);
            setEdgePulse(key, event.status, call.label);
            clearTimers.current.set(key, setTimeout(() => {
              clearTimers.current.delete(key);
              setEdgePulse(key, "idle");
            }, PULSE_CLEAR_MS));
          }
        };

        const remaining = MIN_PULSE_MS - (performance.now() - call.startedAt);
        if (remaining > 0) {
          finishTimers.current.set(event.callId, setTimeout(finishPulse, remaining));
        } else {
          finishPulse();
        }

        setActivity((prev) =>
          prev.map((entry) =>
            entry.id === event.callId
              ? {
                  ...entry,
                  status: event.status,
                  durationMs: event.durationMs,
                  error: event.error,
                }
              : entry
          )
        );

        if (call.clientId) { if (viewer) void refetchSnapshot(); else void refetchClients(); }
      }
    },
    [viewer, refetchSnapshot, refetchServers, refetchEndpoints, refetchClients, setEdgePulse]
  );

  const connection = useEventStream(handleEvent, viewer ? "/api/viewer/events" : "/api/events/stream");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">{viewer && <Network className="size-6 text-primary" />}{viewer ? "Live visualization" : "Overview"}</h1>
          <p className="text-sm text-muted-foreground">{viewer ? "Read-only view of gateway connections and live activity." : "Live topology of every backend server and client endpoint connected to the gateway."}</p>
        </div>
        {viewer && <div className="flex shrink-0 items-center gap-3"><span role="status" className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex"><span className={`size-1.5 rounded-full ${connection === "live" && !snapshotError ? "bg-emerald-500" : "animate-pulse bg-amber-500"}`} />{connection === "live" && !snapshotError ? "Live" : "Reconnecting…"}</span><ThemeToggle /></div>}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(420px,1fr)_24rem] gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[minmax(420px,1fr)]">
        <Card className="glass-panel min-h-[420px] overflow-hidden p-0 ring-0 backdrop-blur-2xl backdrop-saturate-150">
          {!servers || !endpoints || !clients ? (
            <div className="flex h-full items-center justify-center p-8">
              <Skeleton className="h-full w-full" />
            </div>
          ) : (
            <GatewayFlow
              servers={servers ?? []}
              endpoints={endpoints ?? []}
              clients={clients ?? []}
              pulses={pulses}
              visualizationOnly={viewer}
            />
          )}
        </Card>

        <Card className="glass-panel flex min-h-0 flex-col gap-0 overflow-hidden p-0 ring-0 backdrop-blur-2xl backdrop-saturate-150">
          <CardHeader className="shrink-0 border-b py-3">
            <CardTitle id="live-activity-heading" className="text-sm">Live activity</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-hidden p-0">
            <ActivityFeed entries={activity} clients={clients ?? []} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

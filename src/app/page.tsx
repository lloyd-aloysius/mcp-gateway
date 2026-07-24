"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePollingFetch } from "@/lib/hooks/use-polling-fetch";
import { useEventStream, type GatewayEvent } from "@/lib/hooks/use-event-stream";
import { GatewayFlow, type PulseState } from "@/components/flow/gateway-flow";
import { ActivityFeed, type ActivityEntry } from "@/components/flow/activity-feed";

type BackendServerRow = {
  id: string;
  name: string;
  description: string | null;
  connectionType: "stdio" | "http" | "sse";
  command: string | null;
  args: string[] | null;
  url: string | null;
  enabled: boolean;
  status: string;
  lastConnectedAt: string | null;
  lastError: string | null;
  pid: number | null;
};

type EndpointRow = {
  id: string;
  name: string;
  slug: string;
  enabled: boolean;
  defaultPolicy: "allow_all" | "deny_all";
  lastUsedAt: string | null;
  createdAt: string;
  activeSessions: number;
};

type EndpointClientRow = {
  endpointId: string;
  clientId: string;
  label: string | null;
  lastSeenAt: string;
};

type AuditRow = {
  id: number;
  timestamp: string;
  endpointNameSnapshot: string | null;
  backendServerKeySnapshot: string | null;
  operationType: string;
  itemName: string | null;
  status: "success" | "error" | "denied";
  durationMs: number | null;
  errorMessage: string | null;
};

const PULSE_CLEAR_MS = 1500;
const MAX_ACTIVITY_ENTRIES = 30;

function shortToolName(itemName: string | null) {
  if (!itemName) return null;
  const idx = itemName.indexOf("__");
  return idx === -1 ? itemName : itemName.slice(idx + 2);
}

export default function Home() {
  const { data: servers, refetch: refetchServers } =
    usePollingFetch<BackendServerRow[]>("/api/servers", 8000);
  const { data: endpoints, refetch: refetchEndpoints } =
    usePollingFetch<EndpointRow[]>("/api/endpoints", 10000);
  const { data: clients, refetch: refetchClients } =
    usePollingFetch<EndpointClientRow[]>("/api/endpoints/clients", 10000);

  const [pulses, setPulses] = useState<PulseState>({});
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const pendingCalls = useRef<
    Map<
      string,
      {
        serverId: string | null;
        endpointId: string;
        clientId: string | null;
        itemName: string | null;
        endpointName: string;
      }
    >
  >(new Map());
  // Tracks which callIds are still in flight per edge, so concurrent calls sharing an
  // edge don't clobber each other's "active" glow when one of them finishes first.
  const activeCallsByEdge = useRef<Map<string, Set<string>>>(new Map());
  const clearTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const setEdgePulse = useCallback(
    (key: string, status: PulseState[string]["status"], label?: string) => {
      setPulses((prev) => ({ ...prev, [key]: { status, label } }));
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/audit?page=1", { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<{ rows: AuditRow[] }>) : null))
      .then((data) => {
        if (cancelled || !data) return;
        const seeded: ActivityEntry[] = data.rows
          .filter((row) => row.operationType === "tools/call")
          .map((row) => ({
            id: `audit-${row.id}`,
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
  }, []);

  const handleEvent = useCallback(
    (event: GatewayEvent) => {
      if (event.type === "server.status_changed" || event.type.startsWith("endpoint.")) {
        void refetchServers();
        void refetchEndpoints();
        return;
      }

      if (event.type === "call.started") {
        pendingCalls.current.set(event.callId, {
          serverId: event.backendServerId,
          endpointId: event.endpointId,
          clientId: event.clientId,
          itemName: event.itemName,
          endpointName: event.endpointName,
        });

        const label = shortToolName(event.itemName) ?? event.operationType;
        const edgeKeys = [
          event.backendServerId ? `server-${event.backendServerId}` : null,
          `endpoint-${event.endpointId}`,
          event.clientId ? `client-${event.endpointId}-${event.clientId}` : null,
        ].filter((k): k is string => !!k);

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

        const label = shortToolName(call.itemName) ?? undefined;
        const edgeKeys = [
          call.serverId ? `server-${call.serverId}` : null,
          `endpoint-${call.endpointId}`,
          call.clientId ? `client-${call.endpointId}-${call.clientId}` : null,
        ].filter((k): k is string => !!k);

        for (const key of edgeKeys) {
          activeCallsByEdge.current.get(key)?.delete(event.callId);
          setEdgePulse(key, event.status, label);

          const existing = clearTimers.current.get(key);
          if (existing) clearTimeout(existing);
          clearTimers.current.set(
            key,
            setTimeout(() => {
              clearTimers.current.delete(key);
              const stillActive = (activeCallsByEdge.current.get(key)?.size ?? 0) > 0;
              setEdgePulse(key, stillActive ? "active" : "idle");
            }, PULSE_CLEAR_MS)
          );
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

        if (call.clientId) void refetchClients();
      }
    },
    [refetchServers, refetchEndpoints, refetchClients, setEdgePulse]
  );

  useEventStream(handleEvent);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Live topology of every backend server and client endpoint connected to the gateway.
        </p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] gap-4 lg:grid-cols-[1fr_320px]">
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
            />
          )}
        </Card>

        <Card className="glass-panel flex min-h-0 flex-col overflow-hidden p-0 ring-0 backdrop-blur-2xl backdrop-saturate-150">
          <CardHeader className="border-b py-3">
            <CardTitle className="text-sm">Live activity</CardTitle>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-hidden p-0">
            <ActivityFeed entries={activity} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

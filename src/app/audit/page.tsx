"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, ChevronLeft, ChevronRight } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { AuditStatusBadge } from "@/components/audit/audit-status-badge";
import { usePollingFetch } from "@/lib/hooks/use-polling-fetch";
import { useEventStream } from "@/lib/hooks/use-event-stream";

type AuditRow = {
  id: number;
  timestamp: string;
  endpointNameSnapshot: string | null;
  backendServerKeySnapshot: string | null;
  operationType: string;
  itemName: string | null;
  requestArgsJson: string | null;
  requestArgsTruncated: boolean;
  status: "success" | "error" | "denied";
  durationMs: number | null;
  errorMessage: string | null;
};

type EndpointOption = { id: string; name: string };
type ServerOption = { id: string; name: string };

const STATUS_OPTIONS = { all: "All statuses", success: "Success", error: "Error", denied: "Denied" };

export default function AuditPage() {
  const [endpointId, setEndpointId] = useState("all");
  const [backendServerId, setBackendServerId] = useState("all");
  const [clientId, setClientId] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditRow | null>(null);

  const { data: endpoints } = usePollingFetch<EndpointOption[]>("/api/endpoints", 30_000);
  const { data: servers } = usePollingFetch<ServerOption[]>("/api/servers", 30_000);
  const { data: auditClients } = usePollingFetch<string[]>("/api/audit/clients", 30_000);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (endpointId !== "all") params.set("endpointId", endpointId);
    if (backendServerId !== "all") params.set("backendServerId", backendServerId);
    if (clientId !== "all") params.set("clientId", clientId);
    if (status !== "all") params.set("status", status);
    if (search.trim()) params.set("search", search.trim());
    params.set("page", String(page));
    return params.toString();
  }, [endpointId, backendServerId, clientId, status, search, page]);

  const { data, loading, refetch } = usePollingFetch<{
    rows: AuditRow[];
    total: number;
    page: number;
    pageSize: number;
  }>(`/api/audit?${query}`, 15000);

  useEventStream((event) => {
    if (event.type === "audit.appended" && page === 1) void refetch();
  });

  useEffect(() => {
    setPage(1);
  }, [endpointId, backendServerId, clientId, status, search]);

  useEffect(() => {
    void refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const endpointItems = useMemo(() => {
    const map: Record<string, string> = { all: "All endpoints" };
    for (const e of endpoints ?? []) map[e.id] = e.name;
    return map;
  }, [endpoints]);

  const serverItems = useMemo(() => {
    const map: Record<string, string> = { all: "All servers" };
    for (const s of servers ?? []) map[s.id] = s.name;
    return map;
  }, [servers]);

  const clientItems = useMemo(() => {
    const map: Record<string, string> = { all: "All clients" };
    for (const c of auditClients ?? []) map[c] = c;
    return map;
  }, [auditClients]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
          <p className="text-sm text-muted-foreground">
            Every tool call, resource read, and prompt fetch that has passed through the gateway.
          </p>
        </div>
        <Button variant="outline" onClick={() => window.open(`/api/audit/export?${query}`, "_blank")}>
          <Download className="size-4" />
          Export CSV
        </Button>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-start gap-3 py-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Endpoint</label>
            <Select items={endpointItems} value={endpointId} onValueChange={(v) => setEndpointId(v ?? "all")}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(endpointItems).map(([id, label]) => (
                  <SelectItem key={id} value={id}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Server</label>
            <Select items={serverItems} value={backendServerId} onValueChange={(v) => setBackendServerId(v ?? "all")}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(serverItems).map(([id, label]) => (
                  <SelectItem key={id} value={id}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Client</label>
            <Select items={clientItems} value={clientId} onValueChange={(v) => setClientId(v ?? "all")}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(clientItems).map(([id, label]) => (
                  <SelectItem key={id} value={id}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Status</label>
            <Select items={STATUS_OPTIONS} value={status} onValueChange={(v) => setStatus(v ?? "all")}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(STATUS_OPTIONS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-48 flex-1 space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Search</label>
            <Input
              placeholder="Search endpoint, server, tool, or error…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : data && data.rows.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-4 py-3">Time</TableHead>
                  <TableHead className="px-4 py-3">Endpoint</TableHead>
                  <TableHead className="px-4 py-3">Server</TableHead>
                  <TableHead className="px-4 py-3">Operation</TableHead>
                  <TableHead className="px-4 py-3">Item</TableHead>
                  <TableHead className="px-4 py-3">Status</TableHead>
                  <TableHead className="px-4 py-3 text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className="cursor-pointer"
                    onClick={() => setSelected(row)}
                  >
                    <TableCell className="whitespace-nowrap px-4 py-3">
                      <div className="text-sm">{format(new Date(row.timestamp), "MMM d, h:mm:ss a")}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(row.timestamp), { addSuffix: true })}
                      </div>
                    </TableCell>
                    <TableCell className="px-4 py-3">{row.endpointNameSnapshot ?? "—"}</TableCell>
                    <TableCell className="px-4 py-3">{row.backendServerKeySnapshot ?? "—"}</TableCell>
                    <TableCell className="px-4 py-3 font-mono text-xs">{row.operationType}</TableCell>
                    <TableCell className="max-w-56 truncate px-4 py-3 font-mono text-xs">
                      {row.itemName ?? "—"}
                    </TableCell>
                    <TableCell className="px-4 py-3">
                      <AuditStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="px-4 py-3 text-right text-sm text-muted-foreground">
                      {row.durationMs !== null ? `${row.durationMs}ms` : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="p-8 text-center text-muted-foreground">No matching audit entries.</p>
          )}
        </CardContent>
      </Card>

      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages} · {data.total} entries
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="size-4" />
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="w-full sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="font-mono text-sm">{selected?.itemName ?? selected?.operationType}</SheetTitle>
            <SheetDescription>
              {selected && new Date(selected.timestamp).toLocaleString()}
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="space-y-4 px-4 pb-4">
              <div className="flex flex-wrap gap-2">
                <AuditStatusBadge status={selected.status} />
                <span className="text-sm text-muted-foreground">
                  {selected.endpointNameSnapshot} → {selected.backendServerKeySnapshot ?? "—"}
                </span>
              </div>
              {selected.durationMs !== null && (
                <p className="text-sm text-muted-foreground">Duration: {selected.durationMs}ms</p>
              )}
              {selected.errorMessage && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Error</p>
                  <p className="rounded-md bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
                    {selected.errorMessage}
                  </p>
                </div>
              )}
              {selected.requestArgsJson && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">
                    Arguments {selected.requestArgsTruncated && "(truncated)"}
                  </p>
                  <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
                    {JSON.stringify(JSON.parse(selected.requestArgsJson), null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ServerStatusBadge } from "@/components/servers/server-status-badge";

type BackendServerRow = {
  id: string;
  key: string;
  name: string;
  status: string;
};

type Rule = { backendServerId: string; access: "allow" | "deny" };

export function RuleToggleTable({
  endpointId,
  servers,
  initialRules,
  defaultPolicy,
}: {
  endpointId: string;
  servers: BackendServerRow[];
  initialRules: Rule[];
  defaultPolicy: "allow_all" | "deny_all";
}) {
  const [rulesByServer, setRulesByServer] = useState<Record<string, "inherit" | "allow" | "deny">>(
    () => {
      const map: Record<string, "inherit" | "allow" | "deny"> = {};
      for (const s of servers) map[s.id] = "inherit";
      for (const r of initialRules) map[r.backendServerId] = r.access;
      return map;
    }
  );

  async function updateRule(backendServerId: string, access: "inherit" | "allow" | "deny") {
    const prev = rulesByServer[backendServerId];
    setRulesByServer((r) => ({ ...r, [backendServerId]: access }));

    const res = await fetch(`/api/endpoints/${endpointId}/rules`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ backendServerId, access }),
    });

    if (!res.ok) {
      setRulesByServer((r) => ({ ...r, [backendServerId]: prev }));
      toast.error("Failed to update rule");
    }
  }

  if (servers.length === 0) {
    return <p className="text-sm text-muted-foreground">No backend servers configured yet.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Server</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">Access</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {servers.map((server) => {
          const value = rulesByServer[server.id] ?? "inherit";
          return (
            <TableRow key={server.id}>
              <TableCell className="font-medium">{server.name}</TableCell>
              <TableCell>
                <ServerStatusBadge status={server.status} />
              </TableCell>
              <TableCell className="text-right">
                <Select
                  items={{
                    inherit: `Inherit (${defaultPolicy === "allow_all" ? "allow" : "deny"})`,
                    allow: "Allow",
                    deny: "Deny",
                  }}
                  value={value}
                  onValueChange={(v) => updateRule(server.id, v as typeof value)}
                >
                  <SelectTrigger className="ml-auto w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">
                      Inherit ({defaultPolicy === "allow_all" ? "allow" : "deny"})
                    </SelectItem>
                    <SelectItem value="allow">Allow</SelectItem>
                    <SelectItem value="deny">Deny</SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

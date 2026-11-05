import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { backendServerInputSchema } from "@/lib/validation";
import { withAdmin } from "@/server/http/admin";
import { readJsonBody } from "@/server/http/json-body";
import { getDb } from "@/server/db/client";
import { backendServers } from "@/server/db/schema";
import { addOrReplaceConnection } from "@/server/gateway/backend-registry";
import { validateBackendUrl } from "@/server/gateway/egress";
import { BUILTIN_GATEWAY_TOOLS_SERVER_KEY } from "@/server/gateway/seed-builtin-server";

const configSchema = z.object({ version: z.literal(1), backends: z.array(backendServerInputSchema).max(100) });

function exportableReferences(values: Record<string, string> | null) {
  return values && Object.fromEntries(Object.entries(values).filter(([, value]) =>
    /^(?:Bearer )?\$\{env:MCP_BACKEND_SECRET_[A-Z_0-9]+\}$/.test(value)));
}

export const GET = withAdmin(async () => {
  const rows = await getDb().select().from(backendServers);
  const backends = rows.filter(({ key }) => key !== BUILTIN_GATEWAY_TOOLS_SERVER_KEY).map((row) => {
    const common = { key: row.key, name: row.name, description: row.description ?? undefined, enabled: row.enabled };
    return row.connectionType === "stdio"
      ? { ...common, connectionType: row.connectionType, command: row.command, args: row.args,
        env: exportableReferences(row.env) ?? undefined }
      : { ...common, connectionType: row.connectionType, url: row.url,
        headers: exportableReferences(row.headers) ?? undefined };
  });
  return Response.json({ version: 1, backends }, {
    headers: { "content-disposition": 'attachment; filename="mcp-gateway-config.json"' },
  });
});

export const POST = withAdmin(async (req: Request) => {
  const parsed = configSchema.safeParse(await readJsonBody(req));
  if (!parsed.success) return Response.json({ error: "Invalid version 1 configuration" }, { status: 400 });
  const entries = parsed.data.backends;
  if (new Set(entries.map(({ key }) => key)).size !== entries.length ||
      entries.some(({ key }) => key === BUILTIN_GATEWAY_TOOLS_SERVER_KEY || key === "gateway-health")) {
    return Response.json({ error: "Configuration contains a duplicate or reserved backend key" }, { status: 400 });
  }
  try {
    for (const entry of entries) {
      if (entry.connectionType !== "stdio") validateBackendUrl(entry.url);
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid backend URL" }, { status: 400 });
  }

  const db = getDb();
  const apply = new URL(req.url).searchParams.get("apply") === "1";
  const result = db.transaction((tx) => {
    const existing = new Map(tx.select().from(backendServers).all().map((row) => [row.key, row]));
    const changes = entries.map(({ key, enabled }) => ({ key, enabled, action: existing.has(key) ? "update" : "create" }));
    if (!apply) return { changes, rows: [] };
    const rows = entries.map((entry) => {
      const current = existing.get(entry.key);
      const values = {
        name: entry.name,
        description: entry.description ?? null,
        connectionType: entry.connectionType,
        command: entry.connectionType === "stdio" ? entry.command : null,
        args: entry.connectionType === "stdio" ? entry.args : null,
        env: entry.connectionType === "stdio" ? { ...current?.env, ...entry.env } : null,
        url: entry.connectionType !== "stdio" ? entry.url : null,
        headers: entry.connectionType !== "stdio" ? { ...current?.headers, ...entry.headers } : null,
        enabled: entry.enabled,
        status: "disconnected" as const,
        updatedAt: new Date(),
      };
      return current
        ? tx.update(backendServers).set(values).where(eq(backendServers.id, current.id)).returning().get()
        : tx.insert(backendServers).values({ ...values, id: randomUUID(), key: entry.key }).returning().get();
    });
    return { changes, rows };
  });
  for (const row of result.rows) void addOrReplaceConnection(row);
  return Response.json({ applied: apply, changes: result.changes });
});

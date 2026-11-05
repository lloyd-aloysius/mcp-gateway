import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withAdmin } from "@/server/http/admin";
import { readJsonBody } from "@/server/http/json-body";
import { getDb } from "@/server/db/client";
import { backendServers, clientEndpoints, endpointToolPolicies, endpointToolRules } from "@/server/db/schema";
import { evaluateAccess } from "@/server/gateway/access-control";
import { getToolPolicy } from "@/server/gateway/tool-policy";
import { getConnection } from "@/server/gateway/backend-registry";
import { listBackendItems, requestBackend } from "@/server/gateway/backend-requests";

type Context = { params: Promise<{ id: string }> };
const toolPolicyInput = z.union([z.object({
  backendServerId: z.string().min(1).max(128),
  toolName: z.string().min(1).max(256),
  access: z.enum(["inherit", "allow", "deny"]),
}), z.object({ backendServerId: z.string().min(1).max(128), mode: z.enum(["inherit", "allowlist"]) })]);

export const GET = withAdmin(async (req: Request, context: Context) => {
  const { id } = await context.params;
  const backendServerId = new URL(req.url).searchParams.get("backendServerId");
  const db = getDb();
  const endpoint = db.select().from(clientEndpoints).where(eq(clientEndpoints.id, id)).get();
  const backend = backendServerId && db.select().from(backendServers).where(eq(backendServers.id, backendServerId)).get();
  if (!endpoint || !backend) return Response.json({ error: "Endpoint or backend not found" }, { status: 404 });

  const [access, policy] = await Promise.all([
    evaluateAccess(endpoint, backend),
    getToolPolicy(id, backend.id, backend.key),
  ]);
  const conn = getConnection(backend.id);
  const inventory = conn?.client?.getServerCapabilities()?.tools
    ? await requestBackend(conn, req.signal, (client, options) => listBackendItems(async (cursor) => {
      const page = await client.listTools({ cursor }, options);
      return { items: page.tools.map(({ name }) => name), nextCursor: page.nextCursor };
    }), 5_000).catch(() => ({ items: [], partial: true }))
    : { items: [], partial: false };
  const names = [...new Set([...inventory.items, ...policy.rules.map(({ toolName }) => toolName)])].sort();
  return Response.json({
    backendAccess: access,
    mode: policy.mode,
    partial: inventory.partial,
    tools: names.map((name) => {
      const denial = access === "deny" ? "Endpoint or backend does not allow access" : policy.denial(name);
      return {
        name,
        access: policy.rules.find(({ toolName }) => toolName === name)?.access ?? "inherit",
        effective: denial ? "deny" : "allow",
        reason: denial ?? "Allowed by endpoint policy",
      };
    }),
  });
});

export const PUT = withAdmin(async (req: Request, context: Context) => {
  const { id } = await context.params;
  const parsed = toolPolicyInput.safeParse(await readJsonBody(req));
  if (!parsed.success) return Response.json({ error: "Invalid tool rule" }, { status: 400 });
  const input = parsed.data;
  const { backendServerId } = input;
  const db = getDb();
  const saved = db.transaction((tx) => {
    if (!tx.select({ id: clientEndpoints.id }).from(clientEndpoints).where(eq(clientEndpoints.id, id)).get() ||
        !tx.select({ id: backendServers.id }).from(backendServers).where(eq(backendServers.id, backendServerId)).get()) {
      return false;
    }
    if ("mode" in input) {
      tx.insert(endpointToolPolicies).values({ endpointId: id, backendServerId, mode: input.mode })
        .onConflictDoUpdate({ target: [endpointToolPolicies.endpointId, endpointToolPolicies.backendServerId],
          set: { mode: input.mode } }).run();
      return true;
    }
    const { access, toolName } = input;
    if (access === "inherit") {
      tx.delete(endpointToolRules).where(and(eq(endpointToolRules.endpointId, id),
        eq(endpointToolRules.backendServerId, backendServerId), eq(endpointToolRules.toolName, toolName))).run();
    } else {
      tx.insert(endpointToolRules).values({ endpointId: id, backendServerId, toolName, access })
        .onConflictDoUpdate({
          target: [endpointToolRules.endpointId, endpointToolRules.backendServerId, endpointToolRules.toolName],
          set: { access },
        }).run();
      if (access === "allow") {
        tx.insert(endpointToolPolicies).values({ endpointId: id, backendServerId, mode: "allowlist" })
          .onConflictDoNothing().run();
      }
    }
    return true;
  });
  return saved ? Response.json(input) : Response.json({ error: "Endpoint or backend not found" }, { status: 404 });
});

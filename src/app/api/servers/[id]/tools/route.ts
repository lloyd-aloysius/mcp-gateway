import { readJsonBody } from "@/server/http/json-body";
import { withAdmin } from "@/server/http/admin";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { backendServerTools } from "@/server/db/schema";
import { toolToggleInputSchema } from "@/lib/validation";
import { getConnection } from "@/server/gateway/backend-registry";

type Params = { params: Promise<{ id: string }> };

async function get(_req: Request, { params }: Params) {
  const { id } = await params;
  const conn = getConnection(id);
  if (!conn || !conn.client) {
    return NextResponse.json([]);
  }

  const [{ tools }, toggles] = await Promise.all([
    conn.client.listTools(),
    getDb().select().from(backendServerTools).where(eq(backendServerTools.backendServerId, id)),
  ]);

  const toggleByName = new Map(toggles.map((t) => [t.toolName, t.enabled]));
  return NextResponse.json(
    tools.map((t) => ({
      name: t.name,
      description: t.description ?? null,
      enabled: toggleByName.get(t.name) ?? true,
    }))
  );
}

async function put(req: Request, { params }: Params) {
  const { id } = await params;
  const body = await readJsonBody(req);
  const parsed = toolToggleInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { toolName, enabled } = parsed.data;

  const [row] = await getDb().insert(backendServerTools)
    .values({id: randomUUID(), backendServerId: id, toolName, enabled})
    .onConflictDoUpdate({ target: [backendServerTools.backendServerId, backendServerTools.toolName], set: {enabled, updatedAt: new Date()} })
    .returning();
  return NextResponse.json(row);
}

export const GET = withAdmin(get);
export const PUT = withAdmin(put);

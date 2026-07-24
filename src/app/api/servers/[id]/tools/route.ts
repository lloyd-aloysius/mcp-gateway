import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { backendServerTools } from "@/server/db/schema";
import { toolToggleInputSchema } from "@/lib/validation";
import { getConnection } from "@/server/gateway/backend-registry";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const conn = getConnection(id);
  if (!conn || !conn.client) {
    return NextResponse.json([]);
  }

  const [{ tools }, toggles] = await Promise.all([
    conn.client.listTools(),
    db.select().from(backendServerTools).where(eq(backendServerTools.backendServerId, id)),
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

export async function PUT(req: Request, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const parsed = toolToggleInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { toolName, enabled } = parsed.data;

  const [existing] = await db
    .select()
    .from(backendServerTools)
    .where(and(eq(backendServerTools.backendServerId, id), eq(backendServerTools.toolName, toolName)))
    .limit(1);

  let row;
  if (existing) {
    [row] = await db
      .update(backendServerTools)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(backendServerTools.id, existing.id))
      .returning();
  } else {
    [row] = await db
      .insert(backendServerTools)
      .values({ id: randomUUID(), backendServerId: id, toolName, enabled })
      .returning();
  }

  return NextResponse.json(row);
}

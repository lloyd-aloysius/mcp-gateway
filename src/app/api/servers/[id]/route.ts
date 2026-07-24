import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { backendServers } from "@/server/db/schema";
import { backendServerUpdateSchema } from "@/lib/validation";
import { addOrReplaceConnection, getConnection, removeConnection } from "@/server/gateway/backend-registry";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const [row] = await db.select().from(backendServers).where(eq(backendServers.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...row, pid: getConnection(row.id)?.pid ?? null });
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const parsed = backendServerUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  const [existing] = await db.select().from(backendServers).where(eq(backendServers.id, id)).limit(1);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [row] = await db
    .update(backendServers)
    .set({
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      command: "command" in input ? input.command : existing.command,
      args: "args" in input ? input.args : existing.args,
      env: "env" in input ? input.env : existing.env,
      url: "url" in input ? input.url : existing.url,
      headers: "headers" in input ? input.headers : existing.headers,
      enabled: input.enabled ?? existing.enabled,
      updatedAt: new Date(),
    })
    .where(eq(backendServers.id, id))
    .returning();

  void addOrReplaceConnection(row);

  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  await removeConnection(id);
  await db.delete(backendServers).where(eq(backendServers.id, id));
  return NextResponse.json({ ok: true });
}

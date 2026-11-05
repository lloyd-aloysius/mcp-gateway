import { validateBackendUrl } from "@/server/gateway/egress";
import { mergeBackendValues, publicBackend } from "@/server/gateway/backend-secrets";
import { readJsonBody } from "@/server/http/json-body";
import { withAdmin } from "@/server/http/admin";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { backendServers } from "@/server/db/schema";
import { backendServerUpdateSchema } from "@/lib/validation";
import { addOrReplaceConnection, getConnection, removeConnection } from "@/server/gateway/backend-registry";

type Params = { params: Promise<{ id: string }> };

async function get(_req: Request, { params }: Params) {
  const { id } = await params;
  const [row] = await getDb().select().from(backendServers).where(eq(backendServers.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ...publicBackend(row), pid: getConnection(row.id)?.pid ?? null });
}

async function patch(req: Request, { params }: Params) {
  const { id } = await params;
  const body = await readJsonBody(req);
  const parsed = backendServerUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  if (input.url !== undefined) {
    try {
      validateBackendUrl(input.url);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid backend URL" }, { status: 400 });
    }
  }

  const row = getDb().transaction((tx) => {
    const existing = tx.select().from(backendServers).where(eq(backendServers.id, id)).get();
    if (!existing) return undefined;
    return tx.update(backendServers).set({
      ...input,
      env: input.env === undefined ? undefined : mergeBackendValues(existing.env, input.env),
      headers: input.headers === undefined ? undefined : mergeBackendValues(existing.headers, input.headers),
      updatedAt: new Date(),
    }).where(eq(backendServers.id, id)).returning().get();
  });

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  void addOrReplaceConnection(row);

  return NextResponse.json(publicBackend(row));
}

async function remove(_req: Request, { params }: Params) {
  const { id } = await params;
  await getDb().delete(backendServers).where(eq(backendServers.id, id));
  await removeConnection(id);
  return NextResponse.json({ ok: true });
}

export const GET = withAdmin(get);
export const PATCH = withAdmin(patch);
export const DELETE = withAdmin(remove);

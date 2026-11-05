import { readJsonBody } from "@/server/http/json-body";
import { withAdmin } from "@/server/http/admin";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { clientEndpoints } from "@/server/db/schema";
import { clientEndpointUpdateSchema } from "@/lib/validation";
import { emitGatewayEvent } from "@/server/events/bus";
import { closeEndpointSessions } from "@/server/gateway/session-registry";
import { toPublicEndpoint } from "@/server/gateway/serialize";

type Params = { params: Promise<{ id: string }> };

async function get(_req: Request, { params }: Params) {
  const { id } = await params;
  const [row] = await getDb().select().from(clientEndpoints).where(eq(clientEndpoints.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(toPublicEndpoint(row));
}

async function patch(req: Request, { params }: Params) {
  const { id } = await params;
  const body = await readJsonBody(req);
  const parsed = clientEndpointUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  const [row] = await getDb()
    .update(clientEndpoints)
    .set({
      ...input,
      updatedAt: new Date(),
    })
    .where(eq(clientEndpoints.id, id))
    .returning();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (input.enabled === false) await closeEndpointSessions(id);
  emitGatewayEvent({ type: "endpoint.updated", endpointId: id });

  return NextResponse.json(toPublicEndpoint(row));
}

async function remove(_req: Request, { params }: Params) {
  const { id } = await params;
  await getDb().delete(clientEndpoints).where(eq(clientEndpoints.id, id));
  await closeEndpointSessions(id);
  emitGatewayEvent({ type: "endpoint.deleted", endpointId: id });
  return NextResponse.json({ ok: true });
}

export const GET = withAdmin(get);
export const PATCH = withAdmin(patch);
export const DELETE = withAdmin(remove);

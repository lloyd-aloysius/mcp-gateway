import { readJsonBody } from "@/server/http/json-body";
import { withAdmin } from "@/server/http/admin";
import { randomUUID } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { clientEndpoints, endpointClients } from "@/server/db/schema";
import { emitGatewayEvent } from "@/server/events/bus";
import { createEndpointClientSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

async function get(_req: Request, { params }: Params) {
  const { id } = await params;
  const rows = await getDb()
    .select()
    .from(endpointClients)
    .where(eq(endpointClients.endpointId, id))
    .orderBy(desc(endpointClients.lastSeenAt));
  return NextResponse.json(rows);
}

async function post(req: Request, { params }: Params) {
  const { id } = await params;
  const body = await readJsonBody(req);
  const parsed = createEndpointClientSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const db = getDb();
  if (!db.select({ id: clientEndpoints.id }).from(clientEndpoints).where(eq(clientEndpoints.id, id)).get()) {
    return NextResponse.json({ error: "Endpoint not found" }, { status: 404 });
  }
  if (db.select({ id: endpointClients.id }).from(endpointClients).where(eq(endpointClients.endpointId, id)).limit(1).offset(999).get()) {
    return NextResponse.json({ error: "This endpoint has reached its client limit" }, { status: 409 });
  }
  let row;
  try {
    [row] = await getDb()
      .insert(endpointClients)
      .values({ id: randomUUID(), endpointId: id, clientId: parsed.data.clientId, label: parsed.data.label || null, icon: parsed.data.icon })
      .returning();
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed/.test(err.message)) {
      return NextResponse.json({ error: "A client with this id already exists for this endpoint" }, { status: 409 });
    }
    throw err;
  }

  emitGatewayEvent({ type: "client.changed", endpointId: id });
  return NextResponse.json(row, { status: 201 });
}

export const GET = withAdmin(get);
export const POST = withAdmin(post);

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { clientEndpoints } from "@/server/db/schema";
import { clientEndpointInputSchema } from "@/lib/validation";
import { emitGatewayEvent } from "@/server/events/bus";
import { toPublicEndpoint } from "@/server/gateway/serialize";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const [row] = await db.select().from(clientEndpoints).where(eq(clientEndpoints.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(toPublicEndpoint(row));
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const parsed = clientEndpointInputSchema.partial().safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  const [existing] = await db.select().from(clientEndpoints).where(eq(clientEndpoints.id, id)).limit(1);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [row] = await db
    .update(clientEndpoints)
    .set({
      name: input.name ?? existing.name,
      slug: input.slug ?? existing.slug,
      defaultPolicy: input.defaultPolicy ?? existing.defaultPolicy,
      enabled: input.enabled ?? existing.enabled,
      updatedAt: new Date(),
    })
    .where(eq(clientEndpoints.id, id))
    .returning();

  emitGatewayEvent({ type: "endpoint.updated", endpointId: id });

  return NextResponse.json(toPublicEndpoint(row));
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  await db.delete(clientEndpoints).where(eq(clientEndpoints.id, id));
  emitGatewayEvent({ type: "endpoint.deleted", endpointId: id });
  return NextResponse.json({ ok: true });
}

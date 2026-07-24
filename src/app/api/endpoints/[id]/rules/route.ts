import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { endpointServerRules } from "@/server/db/schema";
import { endpointRuleInputSchema } from "@/lib/validation";
import { emitGatewayEvent } from "@/server/events/bus";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db
    .select()
    .from(endpointServerRules)
    .where(eq(endpointServerRules.endpointId, id));
  return NextResponse.json(rows);
}

export async function PUT(req: Request, { params }: Params) {
  const { id: endpointId } = await params;
  const body = await req.json();
  const parsed = endpointRuleInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { backendServerId, access } = parsed.data;

  if (access === "inherit") {
    await db
      .delete(endpointServerRules)
      .where(
        and(
          eq(endpointServerRules.endpointId, endpointId),
          eq(endpointServerRules.backendServerId, backendServerId)
        )
      );
    emitGatewayEvent({ type: "rule.updated", endpointId, backendServerId });
    return NextResponse.json({ ok: true, access: "inherit" });
  }

  const [existing] = await db
    .select()
    .from(endpointServerRules)
    .where(
      and(
        eq(endpointServerRules.endpointId, endpointId),
        eq(endpointServerRules.backendServerId, backendServerId)
      )
    )
    .limit(1);

  let row;
  if (existing) {
    [row] = await db
      .update(endpointServerRules)
      .set({ access })
      .where(eq(endpointServerRules.id, existing.id))
      .returning();
  } else {
    [row] = await db
      .insert(endpointServerRules)
      .values({ id: randomUUID(), endpointId, backendServerId, access })
      .returning();
  }

  emitGatewayEvent({ type: "rule.updated", endpointId, backendServerId });
  return NextResponse.json(row);
}

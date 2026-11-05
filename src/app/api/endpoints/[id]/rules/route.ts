import { readJsonBody } from "@/server/http/json-body";
import { withAdmin } from "@/server/http/admin";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { endpointServerRules } from "@/server/db/schema";
import { endpointRuleInputSchema } from "@/lib/validation";
import { emitGatewayEvent } from "@/server/events/bus";

type Params = { params: Promise<{ id: string }> };

async function get(_req: Request, { params }: Params) {
  const { id } = await params;
  const rows = await getDb()
    .select()
    .from(endpointServerRules)
    .where(eq(endpointServerRules.endpointId, id));
  return NextResponse.json(rows);
}

async function put(req: Request, { params }: Params) {
  const { id: endpointId } = await params;
  const body = await readJsonBody(req);
  const parsed = endpointRuleInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { backendServerId, access } = parsed.data;

  if (access === "inherit") {
    await getDb()
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

  const [row] = await getDb().insert(endpointServerRules)
    .values({id: randomUUID(), endpointId, backendServerId, access})
    .onConflictDoUpdate({ target: [endpointServerRules.endpointId, endpointServerRules.backendServerId], set: {access} })
    .returning();
  emitGatewayEvent({ type: "rule.updated", endpointId, backendServerId });
  return NextResponse.json(row);
}

export const GET = withAdmin(get);
export const PUT = withAdmin(put);

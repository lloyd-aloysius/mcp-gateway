import { withAdmin } from "@/server/http/admin";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { CLIENT_ICON_IDS } from "@/lib/client-identity";
import { readJsonBody } from "@/server/http/json-body";
import { getDb } from "@/server/db/client";
import { endpointClients } from "@/server/db/schema";
import { emitGatewayEvent } from "@/server/events/bus";

const profileId = z.string().min(1).max(128);
const updateInput = z.object({
  id: profileId,
  label: z.string().trim().max(120).nullable().optional(),
  icon: z.enum(CLIENT_ICON_IDS).optional(),
}).strict().refine((data) => data.label !== undefined || data.icon !== undefined);

export const GET = withAdmin(async () => NextResponse.json(await getDb().select().from(endpointClients)));
export const PATCH = withAdmin(async (request: Request) => {
  const parsed = updateInput.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Provide a client id, a name of at most 120 characters, and a supported logo" }, { status: 400 });
  const { id, label, icon } = parsed.data;
  const [row] = await getDb().update(endpointClients)
    .set({ ...(label !== undefined ? { label: label || null } : {}), ...(icon !== undefined ? { icon } : {}) })
    .where(eq(endpointClients.id, id)).returning();
  if (!row) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  emitGatewayEvent({ type: "client.changed", endpointId: row.endpointId });
  return NextResponse.json(row);
});

// Deleting a profile never changes endpoint credentials, rules, sessions or audit rows.
// recordObservedClient discovers the same ID again when another call is recorded.
export const DELETE = withAdmin(async (request: Request) => {
  const parsed = z.object({ id: profileId }).strict().safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Provide a client profile id" }, { status: 400 });
  const [row] = await getDb().delete(endpointClients).where(eq(endpointClients.id, parsed.data.id)).returning();
  if (!row) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  emitGatewayEvent({ type: "client.changed", endpointId: row.endpointId });
  return NextResponse.json({ removed: true });
});

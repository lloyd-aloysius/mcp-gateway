import { withAdmin } from "@/server/http/admin";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { readJsonBody } from "@/server/http/json-body";
import { getDb } from "@/server/db/client";
import { endpointClients } from "@/server/db/schema";

async function get() {
  return NextResponse.json(await getDb().select().from(endpointClients));
}

const clientNameInput = z.object({
  id: z.string().min(1).max(128),
  label: z.string().trim().max(120).nullable(),
}).strict();

export const GET = withAdmin(get);
export const PATCH = withAdmin(async (request: Request) => {
  const parsed = clientNameInput.safeParse(await readJsonBody(request));
  if (!parsed.success) return NextResponse.json({ error: "Provide a client id and a name of at most 120 characters" }, { status: 400 });
  const [row] = await getDb().update(endpointClients)
    .set({ label: parsed.data.label || null })
    .where(eq(endpointClients.id, parsed.data.id)).returning();
  if (!row) return NextResponse.json({ error: "Client not found" }, { status: 404 });
  return NextResponse.json(row);
});

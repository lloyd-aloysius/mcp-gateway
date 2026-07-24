import { randomUUID } from "node:crypto";
import { eq, desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { endpointClients } from "@/server/db/schema";
import { createEndpointClientSchema } from "@/lib/validation";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const rows = await db
    .select()
    .from(endpointClients)
    .where(eq(endpointClients.endpointId, id))
    .orderBy(desc(endpointClients.lastSeenAt));
  return NextResponse.json(rows);
}

export async function POST(req: Request, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  const parsed = createEndpointClientSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  let row;
  try {
    [row] = await db
      .insert(endpointClients)
      .values({ id: randomUUID(), endpointId: id, clientId: parsed.data.clientId })
      .returning();
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed/.test(err.message)) {
      return NextResponse.json({ error: "A client with this id already exists for this endpoint" }, { status: 409 });
    }
    throw err;
  }

  return NextResponse.json(row, { status: 201 });
}

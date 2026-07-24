import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { clientEndpoints } from "@/server/db/schema";
import { clientEndpointInputSchema } from "@/lib/validation";
import { generateToken } from "@/server/tokens";
import { emitGatewayEvent } from "@/server/events/bus";
import { toPublicEndpoint } from "@/server/gateway/serialize";
import { getActiveSessionCountByEndpoint } from "@/server/gateway/endpoint-runtime";

export async function GET() {
  const rows = await db.select().from(clientEndpoints);
  const activeSessions = getActiveSessionCountByEndpoint();
  return NextResponse.json(
    rows.map((row) => ({ ...toPublicEndpoint(row), activeSessions: activeSessions.get(row.id) ?? 0 }))
  );
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = clientEndpointInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;
  const { token, hash, prefix } = generateToken();

  let row;
  try {
    [row] = await db
      .insert(clientEndpoints)
      .values({
        id: randomUUID(),
        name: input.name,
        slug: input.slug,
        tokenHash: hash,
        tokenPrefix: prefix,
        defaultPolicy: input.defaultPolicy,
        enabled: input.enabled,
      })
      .returning();
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed/.test(err.message)) {
      return NextResponse.json({ error: "An endpoint with this slug already exists" }, { status: 409 });
    }
    throw err;
  }

  emitGatewayEvent({ type: "endpoint.created", endpointId: row.id });

  return NextResponse.json({ ...toPublicEndpoint(row), token }, { status: 201 });
}

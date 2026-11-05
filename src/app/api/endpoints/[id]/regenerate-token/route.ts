import { withAdmin } from "@/server/http/admin";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { clientEndpoints } from "@/server/db/schema";
import { generateToken } from "@/server/tokens";
import { emitGatewayEvent } from "@/server/events/bus";
import { closeEndpointSessions } from "@/server/gateway/session-registry";
import { toPublicEndpoint } from "@/server/gateway/serialize";

type Params = { params: Promise<{ id: string }> };

async function post(_req: Request, { params }: Params) {
  const { id } = await params;
  const { token, hash, prefix } = generateToken();

  const [row] = await getDb()
    .update(clientEndpoints)
    .set({ tokenHash: hash, tokenPrefix: prefix, updatedAt: new Date() })
    .where(eq(clientEndpoints.id, id))
    .returning();

  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await closeEndpointSessions(id);
  emitGatewayEvent({ type: "endpoint.updated", endpointId: id });
  return NextResponse.json({ ...toPublicEndpoint(row), token });
}

export const POST = withAdmin(post);

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { backendServers } from "@/server/db/schema";
import { reconnectBackendServer } from "@/server/gateway/reconnect";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  const [row] = await db.select().from(backendServers).where(eq(backendServers.id, id)).limit(1);
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const result = await reconnectBackendServer(row);
  return NextResponse.json(result);
}

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { backendServers } from "@/server/db/schema";
import { reconnectBackendServer } from "@/server/gateway/reconnect";

export async function POST() {
  const rows = await db.select().from(backendServers).where(eq(backendServers.enabled, true));
  const results = await Promise.all(rows.map((row) => reconnectBackendServer(row)));
  return NextResponse.json(results);
}

import { withAdmin } from "@/server/http/admin";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { backendServers } from "@/server/db/schema";
import { reconnectBackendServer } from "@/server/gateway/reconnect";

async function post() {
  const rows = await getDb().select().from(backendServers).where(eq(backendServers.enabled, true));
  const results = await Promise.all(rows.map((row) => reconnectBackendServer(row)));
  return NextResponse.json(results);
}

export const POST = withAdmin(post);

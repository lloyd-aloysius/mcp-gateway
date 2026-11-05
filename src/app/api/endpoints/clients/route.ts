import { withAdmin } from "@/server/http/admin";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { endpointClients } from "@/server/db/schema";

async function get() {
  const rows = await getDb().select().from(endpointClients);
  return NextResponse.json(rows);
}

export const GET = withAdmin(get);

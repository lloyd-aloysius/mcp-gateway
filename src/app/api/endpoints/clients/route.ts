import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { endpointClients } from "@/server/db/schema";

export async function GET() {
  const rows = await db.select().from(endpointClients);
  return NextResponse.json(rows);
}

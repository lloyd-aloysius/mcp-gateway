import { isNotNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";

export async function GET() {
  const rows = await db
    .selectDistinct({ clientId: auditLog.clientId })
    .from(auditLog)
    .where(isNotNull(auditLog.clientId));
  return NextResponse.json(rows.map((r) => r.clientId).filter((id): id is string => id !== null));
}

import { withAdmin } from "@/server/http/admin";
import { isNotNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";

async function get() {
  const rows = await getDb()
    .selectDistinct({ clientId: auditLog.clientId })
    .from(auditLog)
    .where(isNotNull(auditLog.clientId));
  return NextResponse.json(rows.map((r) => r.clientId).filter((id): id is string => id !== null));
}

export const GET = withAdmin(get);

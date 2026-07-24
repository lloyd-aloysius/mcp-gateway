import { and, desc, count } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";
import { buildAuditFilters } from "@/server/audit/build-filters";

const PAGE_SIZE = 50;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const filters = buildAuditFilters(searchParams);
  const where = filters.length > 0 ? and(...filters) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.timestamp))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(auditLog).where(where),
  ]);

  return NextResponse.json({ rows, total, page, pageSize: PAGE_SIZE });
}

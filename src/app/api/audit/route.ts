import { withAdmin } from "@/server/http/admin";
import { and, desc, count, lt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";
import { buildAuditFilters } from "@/server/audit/build-filters";

const PAGE_SIZE = 50;

async function get(req: Request) {
  const { searchParams } = new URL(req.url);
  const page = Number(searchParams.get("page") ?? "1");
  const cursor = searchParams.has("before") ? Number(searchParams.get("before")) : null;
  if (!Number.isSafeInteger(page) || page < 1 || page > 2000 ||
      (cursor !== null && (!Number.isSafeInteger(cursor) || cursor < 1))) {
    return NextResponse.json({ error: "Invalid audit page or cursor" }, { status: 400 });
  }
  const filters = buildAuditFilters(searchParams);
  const where = filters.length > 0 ? and(...filters) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    getDb()
      .select()
      .from(auditLog)
      .where(cursor === null ? where : and(where, lt(auditLog.id, cursor)))
      .orderBy(desc(auditLog.id))
      .limit(PAGE_SIZE)
      .offset(cursor === null ? (page - 1) * PAGE_SIZE : 0),
    getDb().select({ total: count() }).from(auditLog).where(where),
  ]);

  return NextResponse.json({ rows, total, page, pageSize: PAGE_SIZE, nextCursor: rows.length === PAGE_SIZE ? rows.at(-1)?.id : null });
}

export const GET = withAdmin(get);

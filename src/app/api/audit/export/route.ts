import { and, desc } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";
import { buildAuditFilters } from "@/server/audit/build-filters";

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

const COLUMNS = [
  "id",
  "timestamp",
  "endpointNameSnapshot",
  "backendServerKeySnapshot",
  "operationType",
  "itemName",
  "status",
  "durationMs",
  "errorMessage",
] as const;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const filters = buildAuditFilters(searchParams);
  const where = filters.length > 0 ? and(...filters) : undefined;

  const rows = await db.select().from(auditLog).where(where).orderBy(desc(auditLog.timestamp));

  const lines = [COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(
      COLUMNS.map((col) => {
        const value = row[col];
        return csvEscape(value instanceof Date ? value.toISOString() : value);
      }).join(",")
    );
  }

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/csv",
      "content-disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

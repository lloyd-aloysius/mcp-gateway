import { withAdmin } from "@/server/http/admin";
import { and, desc, lt } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";
import { buildAuditFilters } from "@/server/audit/build-filters";

const ROW_LIMIT = 10_000;
const PAGE_SIZE = 200;

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  let str = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === "string" && /^[\s\u0000-\u001f\u007f]*[=+@-]/.test(str)) str = "'" + str;
  if (/[",\r\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

const COLUMNS = [
  "id", "timestamp", "endpointNameSnapshot", "backendServerKeySnapshot",
  "operationType", "itemName", "status", "durationMs", "errorMessage",
] as const;

const selection = Object.fromEntries(COLUMNS.map((name) => [name, auditLog[name]])) as
  Pick<typeof auditLog, (typeof COLUMNS)[number]>;

async function get(req: Request) {
  const { searchParams } = new URL(req.url);
  const filters = buildAuditFilters(searchParams);
  const ndjson = searchParams.get("format") === "ndjson";
  const encoder = new TextEncoder();
  let remaining = ROW_LIMIT;
  let before: number | undefined;

  const stream = new ReadableStream({
    start(controller) {
      if (!ndjson) controller.enqueue(encoder.encode(COLUMNS.join(",") + "\n"));
    },
    async pull(controller) {
      if (!remaining || req.signal.aborted) return controller.close();
      const where = before === undefined ? and(...filters) : and(...filters, lt(auditLog.id, before));
      const rows = await getDb().select(selection).from(auditLog).where(where).orderBy(desc(auditLog.id))
        .limit(Math.min(remaining, PAGE_SIZE));
      if (!rows.length || req.signal.aborted) return controller.close();
      before = rows.at(-1)!.id;
      remaining -= rows.length;
      controller.enqueue(encoder.encode(rows.map((row) => ndjson
        ? JSON.stringify(row)
        : COLUMNS.map((col) => csvEscape(row[col])).join(",")).join("\n") + "\n"));
    },
  });

  const extension = ndjson ? "ndjson" : "csv";
  return new Response(stream, {
    headers: {
      "content-type": ndjson ? "application/x-ndjson" : "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.${extension}"`,
      "x-export-row-limit": String(ROW_LIMIT),
    },
  });
}

export const GET = withAdmin(get);

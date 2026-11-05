import { eq, lt, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { appSettings, auditLog, backendServers, clientEndpoints } from "../db/schema";

const RETENTION_MODE_KEY = "audit_retention_default";
const FRESH_RETENTION_DAYS = 30;
const FRESH_MAX_ROWS = 100_000;

declare global {
  var __gatewayAuditMaintenance: ReturnType<typeof setInterval> | undefined;
}

function readBound(name: string, fallback: number | null, maximum: number): number | null {
  const configured = process.env[name]?.trim();
  if (!configured) return fallback;
  const value = Number(configured);
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : null;
}

export function getAuditRetention() {
  const mode = getDb().select({ value: appSettings.value }).from(appSettings)
    .where(eq(appSettings.key, RETENTION_MODE_KEY)).get()?.value;
  return {
    days: readBound("MCP_GATEWAY_AUDIT_RETENTION_DAYS", mode === "bounded" ? FRESH_RETENTION_DAYS : null, 365),
    maxRows: readBound("MCP_GATEWAY_AUDIT_MAX_ROWS", mode === "bounded" ? FRESH_MAX_ROWS : null, 10_000_000),
  };
}

function initializeRetentionDefault(): void {
  getDb().transaction((tx) => {
    if (tx.select().from(appSettings).where(eq(appSettings.key, RETENTION_MODE_KEY)).get()) return;

    // Run before seeding the first backend. Preserve history on an existing
    // installation unless its operator explicitly configures a limit.
    const existing = tx.select({ key: appSettings.key }).from(appSettings).limit(1).get() ||
      tx.select({ id: backendServers.id }).from(backendServers).limit(1).get() ||
      tx.select({ id: clientEndpoints.id }).from(clientEndpoints).limit(1).get() ||
      tx.select({ id: auditLog.id }).from(auditLog).limit(1).get();
    tx.insert(appSettings).values({ key: RETENTION_MODE_KEY, value: existing ? "preserve" : "bounded" }).run();
  });
}

function pruneAudit(): void {
  try {
    const { days, maxRows } = getAuditRetention();
    getDb().transaction((tx) => {
      if (days !== null) {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60_000);
        tx.delete(auditLog).where(lt(auditLog.timestamp, cutoff)).run();
      }
      if (maxRows !== null) {
        tx.run(sql`DELETE FROM ${auditLog} WHERE id <= (
          SELECT id FROM ${auditLog} ORDER BY id DESC LIMIT 1 OFFSET ${maxRows}
        )`);
      }
    });
  } catch {
    console.warn("mcp-gateway: audit maintenance failed");
  }
}

export function startAuditMaintenance(): void {
  if (globalThis.__gatewayAuditMaintenance) return;
  initializeRetentionDefault();
  const { days, maxRows } = getAuditRetention();
  if (days === null && maxRows === null) return;

  pruneAudit();
  globalThis.__gatewayAuditMaintenance = setInterval(pruneAudit, 5 * 60_000).unref();
}

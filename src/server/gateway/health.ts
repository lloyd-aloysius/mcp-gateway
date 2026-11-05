import { count, eq, gt, sql, and } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { auditLog, backendServers } from "@/server/db/schema";
import { getConnection } from "@/server/gateway/backend-registry";
import { getActiveSessionCount } from "@/server/gateway/session-registry";
import { getAuditRetention } from "@/server/audit/maintenance";

export async function getGatewayHealth() {
  const [configured, outcomes] = await Promise.all([
    getDb().select({ id: backendServers.id, key: backendServers.key }).from(backendServers).where(eq(backendServers.enabled, true)),
    getDb().select({ status: auditLog.status, count: count(),
      averageMs: sql<number | null>`avg(${auditLog.durationMs})` })
      .from(auditLog).where(and(eq(auditLog.operationType, "tools/call"),
        gt(auditLog.timestamp, new Date(Date.now() - 60 * 60_000))))
      .groupBy(auditLog.status),
  ]);
  const backends = configured.map(({ id, key }) => ({ key, status: getConnection(id)?.status ?? "disconnected" }));
  const ready = backends.every(({ status }) => status === "connected");
  const retention = getAuditRetention();
  return {
    ready, backends, activeSessions: getActiveSessionCount(), auditRetentionDays: retention.days, auditMaxRows: retention.maxRows,
    toolCallsLastHour: outcomes,
  };
}

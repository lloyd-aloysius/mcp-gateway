import { desc, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { backendServers, clientEndpoints, endpointClients, auditLog } from "@/server/db/schema";
import { getActiveSessionCountByEndpoint } from "@/server/gateway/endpoint-runtime";
import { authorizeViewer, viewerHeaders } from "@/server/http/viewer";

export async function GET(request: Request) {
  const denied = authorizeViewer(request);
  if (denied) return denied;
  const db = getDb();
  const sessions = getActiveSessionCountByEndpoint();
  const servers = db.select({ id: backendServers.id, name: backendServers.name, connectionType: backendServers.connectionType, enabled: backendServers.enabled, status: backendServers.status, lastConnectedAt: backendServers.lastConnectedAt }).from(backendServers).all();
  const endpoints = db.select({ id: clientEndpoints.id, name: clientEndpoints.name, enabled: clientEndpoints.enabled, lastUsedAt: clientEndpoints.lastUsedAt }).from(clientEndpoints).all().map((row) => ({ ...row, activeSessions: sessions.get(row.id) ?? 0 }));
  const clients = db.select({ endpointId: endpointClients.endpointId, clientId: endpointClients.clientId, label: endpointClients.label, icon: endpointClients.icon, lastSeenAt: endpointClients.lastSeenAt }).from(endpointClients).all();
  const rows = db.select({ id: auditLog.id, timestamp: auditLog.timestamp, endpointId: auditLog.endpointId, clientId: auditLog.clientId, endpointNameSnapshot: auditLog.endpointNameSnapshot, backendServerKeySnapshot: auditLog.backendServerKeySnapshot, itemName: auditLog.itemName, status: auditLog.status, durationMs: auditLog.durationMs }).from(auditLog).where(eq(auditLog.operationType, "tools/call")).orderBy(desc(auditLog.id)).limit(50).all();
  return Response.json({ servers, endpoints, clients, rows }, { headers: viewerHeaders() });
}

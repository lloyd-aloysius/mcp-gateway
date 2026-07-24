import { eq, like, gte, lte, or, type SQL } from "drizzle-orm";
import { auditLog } from "../db/schema";

export function buildAuditFilters(searchParams: URLSearchParams): SQL[] {
  const filters: SQL[] = [];

  const endpointId = searchParams.get("endpointId");
  if (endpointId) filters.push(eq(auditLog.endpointId, endpointId));

  const backendServerId = searchParams.get("backendServerId");
  if (backendServerId) filters.push(eq(auditLog.backendServerId, backendServerId));

  const clientId = searchParams.get("clientId");
  if (clientId) filters.push(eq(auditLog.clientId, clientId));

  const status = searchParams.get("status");
  if (status && ["success", "error", "denied"].includes(status)) {
    filters.push(eq(auditLog.status, status as "success" | "error" | "denied"));
  }

  const itemName = searchParams.get("itemName");
  if (itemName) filters.push(like(auditLog.itemName, `%${itemName}%`));

  const search = searchParams.get("search");
  if (search) {
    const pattern = `%${search}%`;
    const searchFilter = or(
      like(auditLog.endpointNameSnapshot, pattern),
      like(auditLog.backendServerKeySnapshot, pattern),
      like(auditLog.itemName, pattern),
      like(auditLog.errorMessage, pattern)
    );
    if (searchFilter) filters.push(searchFilter);
  }

  const from = searchParams.get("from");
  if (from) filters.push(gte(auditLog.timestamp, new Date(from)));

  const to = searchParams.get("to");
  if (to) filters.push(lte(auditLog.timestamp, new Date(to)));

  return filters;
}

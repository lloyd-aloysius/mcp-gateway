import { eq, like, gte, lte, or, type SQL } from "drizzle-orm";
import { InvalidRequestBody } from "../http/json-body";
import { auditLog } from "../db/schema";

export function buildAuditFilters(searchParams: URLSearchParams): SQL[] {
  const filters: SQL[] = [];
  for (const [, value] of searchParams) {
    if (value.length > 256) throw new InvalidRequestBody(400, "Audit filter is too long");
  }

  const endpointId = searchParams.get("endpointId");
  if (endpointId) filters.push(eq(auditLog.endpointId, endpointId));

  const backendServerId = searchParams.get("backendServerId");
  if (backendServerId) filters.push(eq(auditLog.backendServerId, backendServerId));

  const clientId = searchParams.get("clientId");
  if (clientId) filters.push(eq(auditLog.clientId, clientId));

  const operationType = searchParams.get("operationType");
  if (operationType) {
    const operation = auditLog.operationType.enumValues.find((value) => value === operationType);
    if (!operation) throw new InvalidRequestBody(400, "Invalid audit operation type");
    filters.push(eq(auditLog.operationType, operation));
  }

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
  if (from) {
    const date = new Date(from);
    if (!Number.isFinite(date.getTime())) throw new InvalidRequestBody(400, "Invalid from date");
    filters.push(gte(auditLog.timestamp, date));
  }

  const to = searchParams.get("to");
  if (to) {
    const date = new Date(to);
    if (!Number.isFinite(date.getTime())) throw new InvalidRequestBody(400, "Invalid to date");
    filters.push(lte(auditLog.timestamp, date));
  }

  return filters;
}

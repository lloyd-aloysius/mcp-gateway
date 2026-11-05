import { getDb } from "../db/client";
import { auditLog } from "../db/schema";
import { emitGatewayEvent } from "../events/bus";

export async function recordAdminChange(request: Request): Promise<void> {
  try {
    const [row] = await getDb().insert(auditLog).values({
      operationType: "admin/change",
      itemName: request.method + " " + new URL(request.url).pathname,
      clientId: "admin",
      status: "success",
    }).returning({ id: auditLog.id });
    if (row) emitGatewayEvent({ type: "audit.appended", entryId: row.id });
  } catch {
    console.warn("mcp-gateway: could not record an administrative change");
  }
}

import { db } from "../db/client";
import { auditLog } from "../db/schema";
import { addOrReplaceConnection } from "./backend-registry";
import type { BackendServer } from "../db/schema";

export async function reconnectBackendServer(row: BackendServer) {
  const conn = await addOrReplaceConnection(row);

  await db.insert(auditLog).values({
    backendServerId: row.id,
    backendServerKeySnapshot: row.key,
    operationType: conn.status === "connected" ? "connect" : "disconnect",
    status: conn.status === "connected" ? "success" : "error",
    errorMessage: conn.lastError,
  });

  return { id: row.id, status: conn.status, lastError: conn.lastError, pid: conn.pid };
}

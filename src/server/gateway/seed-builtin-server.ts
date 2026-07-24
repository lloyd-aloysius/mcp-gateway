import path from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { appSettings, backendServers } from "../db/schema";

export const BUILTIN_GATEWAY_TOOLS_SERVER_KEY = "gateway-tools";

const OLD_HEALTH_SERVER_KEY = "gateway-health";
const RENAME_FLAG_KEY = "builtin_gateway_tools_server_renamed";
// Kept literally unchanged from the original health-server seed flag — already-deployed
// instances have this set, so seedBuiltinToolsServer() below stays a no-op for them instead
// of inserting a second, duplicate row under the new key.
const SEED_FLAG_KEY = "builtin_health_server_seeded";

const BUILTIN_SERVER_NAME = "Gateway Server Tools";
const BUILTIN_SERVER_DESCRIPTION =
  "Built-in stdio server exposing gateway health/status tools and an admin tool for adding backend servers.";

function builtinScriptArgs() {
  return [path.join(process.cwd(), "scripts", "gateway-tools-server.mjs")];
}

export async function migrateBuiltinToolsServerKey() {
  const [flag] = await db.select().from(appSettings).where(eq(appSettings.key, RENAME_FLAG_KEY)).limit(1);
  if (flag) return;

  const [existing] = await db
    .select()
    .from(backendServers)
    .where(eq(backendServers.key, OLD_HEALTH_SERVER_KEY))
    .limit(1);

  if (existing) {
    await db
      .update(backendServers)
      .set({
        key: BUILTIN_GATEWAY_TOOLS_SERVER_KEY,
        name: BUILTIN_SERVER_NAME,
        description: BUILTIN_SERVER_DESCRIPTION,
        command: process.execPath,
        args: builtinScriptArgs(),
        updatedAt: new Date(),
      })
      .where(eq(backendServers.id, existing.id));
  }

  await db.insert(appSettings).values({ key: RENAME_FLAG_KEY, value: "1" }).onConflictDoNothing();
}

export async function seedBuiltinToolsServer() {
  const [flag] = await db.select().from(appSettings).where(eq(appSettings.key, SEED_FLAG_KEY)).limit(1);
  if (flag) return;

  await db
    .insert(backendServers)
    .values({
      id: randomUUID(),
      key: BUILTIN_GATEWAY_TOOLS_SERVER_KEY,
      name: BUILTIN_SERVER_NAME,
      description: BUILTIN_SERVER_DESCRIPTION,
      connectionType: "stdio",
      command: process.execPath,
      args: builtinScriptArgs(),
      enabled: true,
      status: "disconnected",
    })
    .onConflictDoNothing();

  await db.insert(appSettings).values({ key: SEED_FLAG_KEY, value: "1" }).onConflictDoNothing();
}

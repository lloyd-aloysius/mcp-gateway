export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { runMigrations } = await import("./src/server/db/migrate");
  runMigrations();

  const { migrateBuiltinToolsServerKey, seedBuiltinToolsServer } = await import(
    "./src/server/gateway/seed-builtin-server"
  );
  await migrateBuiltinToolsServerKey();
  await seedBuiltinToolsServer();

  const { bootstrapBackendRegistry } = await import(
    "./src/server/gateway/backend-registry"
  );
  await bootstrapBackendRegistry();
}

declare global {
  var __gatewaySignalHandlersInstalled: boolean | undefined;
}

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { runMigrations } = await import("./src/server/db/migrate");
  runMigrations();

  const { startAuditMaintenance } = await import("./src/server/audit/maintenance");
  startAuditMaintenance();
  const { startSessionMaintenance } = await import("./src/server/gateway/session-registry");
  startSessionMaintenance();

  const { migrateBuiltinToolsServerKey, seedBuiltinToolsServer, refreshManagedBuiltinServer } = await import(
    "./src/server/gateway/seed-builtin-server"
  );
  await migrateBuiltinToolsServerKey();
  await seedBuiltinToolsServer();
  await refreshManagedBuiltinServer();

  const { bootstrapBackendRegistry, closeAllBackends } = await import(
    "./src/server/gateway/backend-registry"
  );
  if (process.env.NEXT_MANUAL_SIG_HANDLE === "1" && !globalThis.__gatewaySignalHandlersInstalled) {
    globalThis.__gatewaySignalHandlersInstalled = true;
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      const deadline = setTimeout(() => process.exit(1), 5_000);
      await closeAllBackends();
      clearTimeout(deadline);
      process.exit(0);
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  }

  await bootstrapBackendRegistry();
}

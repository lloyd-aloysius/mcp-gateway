import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

// (This project vendors its own arm64 Linux build of better-sqlite3 - see
// vendor/better-sqlite3-prebuilds/README.md - because upstream's own arm64
// prebuild required a newer glibc than their x64 one did.)

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "gateway.db");

function resolveDbPath() {
  const configured = process.env.DATABASE_PATH;
  return configured ? path.resolve(configured) : DEFAULT_DB_PATH;
}

function createDb() {
  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  // better-sqlite3 resolves its native binding lazily, right here at
  // construction time (confirmed empirically - requiring the package alone
  // never throws even with no working binding present) - not at import time,
  // so this is the one place a platform-specific load failure (e.g. a
  // missing shared library) can actually be caught, instead of surfacing as
  // a raw, unexplained native stack trace.
  let sqlite: InstanceType<typeof Database>;
  try {
    sqlite = new Database(dbPath);
  } catch (err) {
    console.error(
      "mcp-gateway: failed to load the native SQLite binding for this platform.\n\n" +
        "This usually means a required system library is missing (e.g. libstdc++ on\n" +
        "a minimal Linux base image) or the platform genuinely isn't supported.\n" +
        "This project's official Docker image (see README.md > Docker) sidesteps\n" +
        "platform issues like this entirely.\n\n" +
        "Original error:\n"
    );
    console.error(err);
    process.exit(1);
  }

  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  return drizzle(sqlite, { schema });
}

declare global {
  var __gatewayDb: ReturnType<typeof createDb> | undefined;
}

export const db = globalThis.__gatewayDb ?? createDb();

if (process.env.NODE_ENV !== "production") {
  globalThis.__gatewayDb = db;
}

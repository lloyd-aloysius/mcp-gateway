import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "gateway.db");

function resolveDbPath() {
  const configured = process.env.DATABASE_PATH;
  return configured ? path.resolve(configured) : DEFAULT_DB_PATH;
}

function createDb() {
  const dbPath = resolveDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
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

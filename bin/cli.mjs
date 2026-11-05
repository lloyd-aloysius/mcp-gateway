#!/usr/bin/env node
// Entry point for `npx mcp-gateway` / `npx github:<user>/mcp-gateway` / a
// global `npm install -g` / `npm start` in a git clone (via scripts/start.mjs,
// which just re-execs this file). Runs the prebuilt standalone server (see
// next.config.ts's `output: "standalone"` and scripts/copy-standalone-assets.mjs,
// folded into `npm run build`) so consumers don't need the full source tree,
// devDependencies, or a build step at install time.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const version = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")).version;
if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(version);
  process.exit(0);
}
if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`mcp-gateway ${version}

Usage: mcp-gateway [--help | --version | doctor]

Configuration: .env, HOST, PORT, DATABASE_PATH, MCP_GATEWAY_ADMIN_TOKEN`);
  process.exit(0);
}
const serverEntry = path.join(packageRoot, ".next", "standalone", "server.js");
if (process.argv[2] === "doctor") {
  const report = { version, node: process.version, platform: process.platform, arch: process.arch };
  try {
    const Database = createRequire(serverEntry)("better-sqlite3");
    const database = new Database(":memory:");
    try {
      report.sqlite = database.prepare("SELECT sqlite_version()").pluck().get();
    } finally {
      database.close();
    }
  } catch {
    report.sqlite = "unavailable";
    process.exitCode = 1;
  }
  console.log(JSON.stringify(report));
  process.exit();
}

if (!existsSync(serverEntry)) {
  console.error(
    "mcp-gateway: no production build found in this package.\n" +
      "If you're developing locally, run `npm run build` first.\n" +
      "If you installed this via npm/npx, the package is broken — please file an issue.",
  );
  process.exit(1);
}

// The server needs to run with its own directory as cwd (that's where its
// trimmed node_modules, drizzle/, and scripts/ live) — but a user's data
// (the SQLite file) belongs in *their* working directory, not inside the
// installed package. Resolve it from the real invocation cwd before we hand
// the server a different one.
const userCwd = process.cwd();

// next start / next dev load .env automatically; running server.js directly
// doesn't, and PORT/HOSTNAME need to be known before we even spawn it — so
// parse a .env in the user's own directory here, same as the old start.mjs did.
function loadDotEnv() {
  const envPath = path.join(userCwd, ".env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const match = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/.exec(line);
    if (!match) continue;
    const [, key, rawValue = ""] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}
loadDotEnv();

const databasePath = process.env.DATABASE_PATH
  ? path.resolve(userCwd, process.env.DATABASE_PATH)
  : path.join(userCwd, "data", "gateway.db");

const port = process.env.PORT || "3000";
const hostname = process.env.HOST || process.env.HOSTNAME || "127.0.0.1";

console.log(`mcp-gateway: starting on http://${hostname}:${port}`);
console.log(`mcp-gateway: database at ${databasePath}`);

const child = spawn(process.execPath, [serverEntry], {
  cwd: path.dirname(serverEntry),
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: port,
    HOSTNAME: hostname,
    DATABASE_PATH: databasePath,
    NEXT_MANUAL_SIG_HANDLE: "1",
  },
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error("mcp-gateway: could not start server", error.message);
  process.exit(1);
});
child.on("exit", (code, signal) => process.exit(code ?? (signal === "SIGINT" ? 130 : 143)));

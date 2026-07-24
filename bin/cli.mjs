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
import { spawn } from "node:child_process";

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const serverEntry = path.join(packageRoot, ".next", "standalone", "server.js");

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
const hostname = process.env.HOSTNAME || process.env.HOST || "127.0.0.1";

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
  },
});

child.on("exit", (code) => process.exit(code ?? 0));

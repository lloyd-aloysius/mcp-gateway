import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output lets this app ship as a self-contained CLI package
  // (see bin/cli.mjs) — the build produces .next/standalone/server.js plus
  // a trimmed node_modules, instead of requiring the full project + devDeps
  // to be present at runtime.
  output: "standalone",
  // better-sqlite3 ships a native .node binding; keep it out of the webpack
  // bundle so it's `require()`d directly from node_modules (and correctly
  // copied as-is into the standalone output) instead of being bundled.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;

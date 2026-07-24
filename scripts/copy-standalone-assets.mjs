// next build --output standalone traces JS import graphs, but doesn't know
// about files only ever referenced by a runtime path string: the Drizzle
// migration SQL folder and the gateway-tools-server.mjs script (spawned as a
// separate child process, never imported). Copy them in manually, alongside
// the two folders Next's own docs say to copy by hand (public/, .next/static).
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");

if (!existsSync(standalone)) {
  console.error("copy-standalone-assets: .next/standalone not found — run `next build` first.");
  process.exit(1);
}

const copies = [
  ["public", "public"],
  [path.join(".next", "static"), path.join(".next", "static")],
  ["drizzle", "drizzle"],
  ["scripts", "scripts"],
  // gateway-tools-server.mjs is spawned as its own plain `node` process, not
  // bundled by webpack like the rest of the server — so unlike everything
  // else the SDK isn't traced/inlined for it, and it needs a real,
  // resolvable node_modules copy alongside it.
  [path.join("node_modules", "@modelcontextprotocol"), path.join("node_modules", "@modelcontextprotocol")],
  // Next's standalone output tracing doesn't pick up instrumentation.js —
  // confirmed empirically (it's absent from .next/standalone/.next/server
  // even though next-server.js explicitly looks for it there at
  // <dir>/<distDir>/server/instrumentation.js). Without it, DB migrations
  // and the built-in server seed never run on first boot. Copy it in by hand.
  [
    path.join(".next", "server", "instrumentation.js"),
    path.join(".next", "server", "instrumentation.js"),
  ],
];

for (const [from, to] of copies) {
  const src = path.join(root, from);
  const dest = path.join(standalone, to);
  if (!existsSync(src)) continue;
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  console.log(`copy-standalone-assets: ${from} -> .next/standalone/${to}`);
}

// instrumentation.js's own Turbopack runtime chunk isn't in the standalone
// build's already-trimmed chunks dir either (also empirically confirmed —
// tracing only followed the page/route entry points, not this one). Merge
// the full chunks dir on top rather than hunting down the one chunk it
// needs; skip source maps since nothing here reads them at runtime.
const chunksSrc = path.join(root, ".next", "server", "chunks");
const chunksDest = path.join(standalone, ".next", "server", "chunks");
if (existsSync(chunksSrc)) {
  cpSync(chunksSrc, chunksDest, {
    recursive: true,
    filter: (src) => !src.endsWith(".map"),
  });
  console.log("copy-standalone-assets: .next/server/chunks -> .next/standalone/.next/server/chunks (merged)");
}

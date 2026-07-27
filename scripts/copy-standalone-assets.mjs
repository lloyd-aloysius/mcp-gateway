// next build --output standalone traces JS import graphs, but doesn't know
// about files only ever referenced by a runtime path string: the Drizzle
// migration SQL folder and the gateway-tools-server.mjs script (spawned as a
// separate child process, never imported). Copy them in manually, alongside
// the two folders Next's own docs say to copy by hand (public/, .next/static).
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { nodeFileTrace } from "@vercel/nft";

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
  // Next's standalone output tracing doesn't pick up instrumentation.js —
  // confirmed empirically (it's absent from .next/standalone/.next/server
  // even though next-server.js explicitly looks for it there at
  // <dir>/<distDir>/server/instrumentation.js). Without it, DB migrations
  // and the built-in server seed never run on first boot. Copy it in by hand.
  [
    path.join(".next", "server", "instrumentation.js"),
    path.join(".next", "server", "instrumentation.js"),
  ],
  // better-sqlite3's own npm package ships prebuilt native bindings for
  // every platform/arch it supports (confirmed by inspecting the real
  // registry tarball directly - all 8: darwin/linux/linuxmusl/win32 x
  // x64/arm64). But Next's standalone tracing resolves getPrebuildPath()'s
  // dynamic `${platform}-${arch}.node` lookup against whichever machine
  // actually runs the build, and only copies that one file - confirmed
  // empirically: a build on this (arm64) Mac produced a standalone output
  // containing only darwin-arm64.node. Since CI publishes from a Linux x64
  // runner, every previously-published tarball shipped only an x64 Linux
  // binary, silently breaking every other platform (Apple Silicon Macs
  // included) with a cryptic "cannot find module .../build/Release/..."
  // error, no matter which machine built the release. Copy the whole
  // prebuilds directory ourselves so the platform that happens to run the
  // build stops mattering at all.
  [
    path.join("node_modules", "better-sqlite3", "prebuilds"),
    path.join("node_modules", "better-sqlite3", "prebuilds"),
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

// Upstream's better-sqlite3 arm64 Linux prebuild needs glibc >= 2.38, while
// their x64 Linux prebuild only needs >= 2.34 - a mismatch baked into their
// own binaries, not this project. That excludes arm64 hosts on Debian 12,
// Ubuntu 22.04, RHEL 9, and Amazon Linux 2023 even though the identical x64
// host on the same distro works fine. Overwrite just that one file with our
// own rebuild (see vendor/better-sqlite3-prebuilds/README.md for how it was
// built and how to regenerate it) - verified to need only glibc >= 2.29,
// lower than even the x64 build's own floor.
const arm64Override = path.join(root, "vendor", "better-sqlite3-prebuilds", "linux-arm64.node");
if (existsSync(arm64Override)) {
  const dest = path.join(standalone, "node_modules", "better-sqlite3", "prebuilds", "linux-arm64.node");
  cpSync(arm64Override, dest);
  console.log("copy-standalone-assets: vendored linux-arm64.node override -> .next/standalone (glibc >=2.29 instead of upstream's >=2.38)");
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

// gateway-tools-server.mjs is spawned as its own plain `node` process, not
// bundled by webpack like the rest of the server — so unlike everything
// else, its imports (the whole MCP SDK, and every one of *its* transitive
// dependencies, several layers deep — zod, ajv, ajv's own nested
// fast-deep-equal, and so on) aren't traced/inlined for it at all. It needs
// a real, fully-resolvable node_modules tree alongside it.
//
// Hand-vendoring package names here turned into real whack-a-mole (each
// fix surfaced the *next* missing transitive dependency one boot-failure
// at a time) - some of this dependency tree used to resolve by accident
// only because those packages were also declared as one of *our* top-level
// dependencies. Now that runtime deps are properly minimized (everything's
// self-contained in this standalone output), that accidental resolution
// path is gone. Instead of maintaining that list by hand, use @vercel/nft -
// the same file-tracing library Next.js itself uses internally for
// standalone output - to compute the script's actual full dependency
// closure, and copy exactly those files.
const { fileList, warnings } = await nodeFileTrace([path.join(root, "scripts", "gateway-tools-server.mjs")], {
  base: root,
});
for (const warning of warnings) {
  console.warn(`copy-standalone-assets: nft warning: ${warning.message}`);
}
let tracedCount = 0;
for (const file of fileList) {
  if (!file.startsWith("node_modules")) continue; // scripts/ itself already copied above
  const src = path.join(root, file);
  const dest = path.join(standalone, file);
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(src, dest);
  tracedCount++;
}
console.log(`copy-standalone-assets: vendored ${tracedCount} traced dependency files for gateway-tools-server.mjs`);

// Turbopack externalizes better-sqlite3 (correctly — it's in
// serverExternalPackages) but references it under a hashed synthetic name
// (e.g. "better-sqlite3-90e2652d1716b047") instead of the plain package
// name, and generates a matching aliased directory at
// .next/standalone/.next/node_modules/<hashed-name>. That path contains a
// "node_modules" segment, so `npm publish` silently drops it regardless of
// the "files" allowlist — npm never packs anything nested under a
// node_modules directory unless it's a declared bundled dependency. The
// result: every published tarball references a module that doesn't exist
// in it, and the app 500s on first request. Confirmed by extracting the
// real published 0.1.1 tarball and finding the reference with no target.
//
// The real, correctly-named package IS present at
// .next/standalone/node_modules/better-sqlite3 (npm doesn't strip that one
// — no node_modules segment above it within the packed tree). So instead
// of trying to preserve the hashed alias directory, rewrite every
// reference back to the plain name across the compiled server output.
const hashedRefPattern = /better-sqlite3-[a-f0-9]{8,}/g;
let rewrittenFiles = 0;

function rewriteHashedSqliteRefs(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules") continue; // never rewrite inside vendored packages
      rewriteHashedSqliteRefs(full);
    } else if (entry.endsWith(".js")) {
      const content = readFileSync(full, "utf8");
      if (hashedRefPattern.test(content)) {
        writeFileSync(full, content.replace(hashedRefPattern, "better-sqlite3"));
        rewrittenFiles++;
      }
    }
  }
}

const serverDir = path.join(standalone, ".next", "server");
if (existsSync(serverDir)) {
  rewriteHashedSqliteRefs(serverDir);
  console.log(`copy-standalone-assets: rewrote hashed better-sqlite3 alias in ${rewrittenFiles} file(s)`);
}

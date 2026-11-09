import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [manifest, root = process.cwd()] = process.argv.slice(2);
if (!manifest) throw new Error("Usage: node scripts/check-package.mjs <npm pack JSON> [package root]");
const [pack] = JSON.parse(readFileSync(manifest, "utf8"));
const files = new Set(pack.files.map(({ path }) => path));
const standalone = ".next/standalone/";
const required = [
  "bin/cli.mjs",
  "docs/client-icons.md",
  "docs/licenses/lobe-icons-MIT.txt",
  "docs/screenshots/client-settings.png",
  "skills/mcp-gateway/SKILL.md",
  "skills/mcp-gateway/LICENSE",
  "skills/mcp-gateway/agents/openai.yaml",
  "skills/mcp-gateway-operator/SKILL.md",
  "skills/mcp-gateway-operator/LICENSE",
  "skills/mcp-gateway-operator/agents/openai.yaml",
  "skills/mcp-gateway-operator/references/admin-api.md",
  standalone + "drizzle/0004_client_icons.sql",
  ...["openclaw", "hermes", "cursor", "windsurf", "githubcopilot", "claude"].map((name) => standalone + "public/client-icons/" + name + ".svg"),
  "docs/licenses/hermes-agent-MIT.txt",
  "docs/licenses/simple-icons-CC0.txt",
  "docs/screenshots/client-editor.png",
  standalone + "server.js",
  standalone + ".next/server/instrumentation.js",
  standalone + "drizzle/meta/_journal.json",
  standalone + "scripts/gateway-tools-server.mjs",
  ...["darwin", "linux", "linuxmusl", "win32"].flatMap((platform) =>
    ["arm64", "x64"].map((arch) => standalone + "node_modules/better-sqlite3/prebuilds/" + platform + "-" + arch + ".node")),
];
for (const file of required) {
  if (!files.has(file)) throw new Error("Missing runtime file: " + file);
}
for (const file of files) {
  if (/(?:^|\/)(?:\.env(?:\..*)?|[^/]+\.(?:db|sqlite3?|pem|key)(?:-wal|-shm)?)$/i.test(file)) {
    throw new Error("Unexpected database, environment file, or key in package: " + file);
  }
}

const components = new Map();
for (const file of files) {
  if (/node_modules\/(?:@[^/]+\/)?[^/]+\/package\.json$/.test(file)) {
    const { name, version } = JSON.parse(readFileSync(join(root, file), "utf8"));
    if (name && version) components.set(name + "@" + version, { type: "library", name, version });
  } else if (file.endsWith(".node")) {
    const hash = createHash("sha256").update(readFileSync(join(root, file))).digest("hex");
    components.set(file, { type: "file", name: file, hashes: [{ alg: "SHA-256", content: hash }] });
  }
}

console.log(JSON.stringify({
  bomFormat: "CycloneDX", specVersion: "1.6", version: 1,
  metadata: { component: { type: "application", name: pack.name, version: pack.version } },
  components: [...components.values()],
}, null, 2));

import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = "/app";
const components = new Map();
const app = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) {
      scan(file);
    } else if (entry.name === "package.json") {
      const { name, version } = JSON.parse(readFileSync(file, "utf8"));
      if (name && version) components.set(name + "@" + version, { type: "library", name, version });
    } else if (entry.name.endsWith(".node")) {
      const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
      components.set(file, { type: "file", name: file, hashes: [{ alg: "SHA-256", content: hash }] });
    }
  }
}
scan(join(root, "node_modules"));
for (const entry of readFileSync("/lib/apk/db/installed", "utf8").split("\n\n")) {
  const name = /^P:(.*)$/m.exec(entry)?.[1];
  const version = /^V:(.*)$/m.exec(entry)?.[1];
  if (name && version) components.set("apk:" + name, { type: "library", name, version,
    properties: [{ name: "mcp-gateway:package-manager", value: "apk" }] });
}
components.set("node", { type: "platform", name: "Node.js", version: process.versions.node });

console.log(JSON.stringify({
  bomFormat: "CycloneDX", specVersion: "1.6", version: 1,
  metadata: { component: { type: "container", name: app.name, version: app.version } },
  components: [...components.values()],
}, null, 2));

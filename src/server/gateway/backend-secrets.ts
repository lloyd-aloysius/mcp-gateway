import type { BackendServer } from "../db/schema";

function maskValues(values: Record<string, string> | null) {
  return values && Object.fromEntries(Object.keys(values).map((key) => [key, ""]));
}

export function publicBackend(server: BackendServer) {
  return { ...server, env: maskValues(server.env), headers: maskValues(server.headers) };
}

export function mergeBackendValues(
  stored: Record<string, string> | null,
  edited: Record<string, string | null>,
) {
  const entries: [string, string][] = [];
  for (const [name, value] of Object.entries(edited)) {
    if (value !== null) entries.push([name, value]);
    else if (stored && Object.hasOwn(stored, name)) entries.push([name, stored[name]]);
  }
  return Object.fromEntries(entries);
}

export function resolveBackendValues(values: Record<string, string> | null): Record<string, string> | undefined {
  if (!values) return;
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [
    key,
    value.replace(/\$\{env:([A-Z_][A-Z_0-9]*)\}/g, (_reference, name: string) => {
      if (!name.startsWith("MCP_BACKEND_SECRET_")) {
        throw new Error("Backend secret references must use MCP_BACKEND_SECRET_ variables");
      }
      const resolved = process.env[name];
      if (resolved === undefined) throw new Error("A referenced backend secret is missing");
      return resolved;
    }),
  ]));
}

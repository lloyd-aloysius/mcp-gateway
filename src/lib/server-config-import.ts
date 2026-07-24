export type ParsedServerConfig = {
  connectionType: "stdio" | "http" | "sse";
  key?: string;
  name?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
};

export type ParseResult = { ok: true; value: ParsedServerConfig } | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function filterStringRecord(value: Record<string, unknown>): Record<string, string> {
  const record: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string") record[k] = v;
  }
  return record;
}

function suggestKey(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildFromServerObject(value: unknown, nameHint?: string): ParseResult {
  if (!isPlainObject(value)) {
    return { ok: false, error: "Server config must be an object" };
  }

  const hasCommand = typeof value.command === "string" && value.command.trim().length > 0;
  const hasUrl = typeof value.url === "string" && value.url.trim().length > 0;

  if (!hasCommand && !hasUrl) {
    return { ok: false, error: "Server config must include either 'command' (stdio) or 'url' (http/sse)" };
  }

  if (hasCommand) {
    const result: ParsedServerConfig = {
      connectionType: "stdio",
      command: value.command as string,
    };
    if (Array.isArray(value.args)) {
      result.args = value.args.filter((a): a is string => typeof a === "string");
    }
    if (isPlainObject(value.env)) {
      result.env = filterStringRecord(value.env);
    }
    if (nameHint) {
      result.name = nameHint;
      result.key = suggestKey(nameHint);
    }
    return { ok: true, value: result };
  }

  // http/sse — infer from an explicit type/transport field if present, default to "http" since
  // there's no reliable way to distinguish intent from a bare url alone.
  const explicitType =
    typeof value.type === "string" ? value.type : typeof value.transport === "string" ? value.transport : undefined;
  const connectionType: "http" | "sse" = explicitType === "sse" || explicitType === "sse-only" ? "sse" : "http";

  const result: ParsedServerConfig = {
    connectionType,
    url: value.url as string,
  };
  if (isPlainObject(value.headers)) {
    result.headers = filterStringRecord(value.headers);
  }
  if (nameHint) {
    result.name = nameHint;
    result.key = suggestKey(nameHint);
  }
  return { ok: true, value: result };
}

/**
 * Parses a pasted MCP server config — a bare `{command,args,env}` / `{url,headers}` object, a
 * full `{"mcpServers":{"name":{...}}}` wrapper, or a `{"name":{...}}` shorthand — into prefill
 * values for the guided Add Server form. Never auto-submits; the caller always routes the result
 * through the guided fields for review.
 */
export function parseServerConfigPaste(raw: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, error: "Expected a JSON object" };
  }

  if (isPlainObject(parsed.mcpServers)) {
    const entries = Object.entries(parsed.mcpServers);
    if (entries.length === 0) {
      return { ok: false, error: "No servers found under 'mcpServers'" };
    }
    if (entries.length > 1) {
      return {
        ok: false,
        error: `Paste one server at a time — found ${entries.length} entries under 'mcpServers'`,
      };
    }
    const [name, inner] = entries[0];
    return buildFromServerObject(inner, name);
  }

  if ("command" in parsed || "url" in parsed) {
    return buildFromServerObject(parsed);
  }

  const keys = Object.keys(parsed);
  if (keys.length === 1) {
    const [name] = keys;
    const inner = parsed[name];
    if (isPlainObject(inner) && ("command" in inner || "url" in inner)) {
      return buildFromServerObject(inner, name);
    }
  }

  return {
    ok: false,
    error: "Unrecognized config shape — expected a server object with 'command' or 'url', or an mcpServers wrapper",
  };
}

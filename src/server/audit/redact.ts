const REDACT_KEY_PATTERN = /(password|token|secret|api.?key|authorization|cookie|credential|private.?key)/i;
const MAX_ARGS_JSON_LENGTH = 8192;

function redactValue(value: unknown, depth: number): unknown {
  if (depth >= 6) return "[depth limit]";
  if (typeof value === "string") return value.length > 256 ? value.slice(0, 256) + "…" : value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redactValue(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, entry]) => [
      key,
      REDACT_KEY_PATTERN.test(key) ? "[redacted]" : redactValue(entry, depth + 1),
    ]));
  }
  return value;
}

export function prepareArgsForAudit(args: unknown): { json: string | null; truncated: boolean } {
  if (args === undefined || process.env.MCP_GATEWAY_CAPTURE_AUDIT_ARGS !== "1") {
    return { json: null, truncated: false };
  }
  const json = JSON.stringify(redactValue(args, 0));
  if (json.length <= MAX_ARGS_JSON_LENGTH) return { json, truncated: false };
  return { json: JSON.stringify({ truncated: true }), truncated: true };
}

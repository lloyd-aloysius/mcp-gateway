const REDACT_KEY_PATTERN = /(password|token|secret|apikey|api_key|authorization)/i;
const MAX_ARGS_JSON_LENGTH = 8192;

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEY_PATTERN.test(k) ? "[redacted]" : redactValue(v);
    }
    return out;
  }
  return value;
}

export function prepareArgsForAudit(args: unknown): {
  json: string | null;
  truncated: boolean;
} {
  if (args === undefined) return { json: null, truncated: false };

  const redacted = redactValue(args);
  const json = JSON.stringify(redacted);
  if (json.length <= MAX_ARGS_JSON_LENGTH) {
    return { json, truncated: false };
  }
  return { json: json.slice(0, MAX_ARGS_JSON_LENGTH), truncated: true };
}

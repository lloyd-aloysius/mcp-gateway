import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { BackendConnection } from "./backend-registry";

const MAX_CONCURRENT = 8;
const running = new WeakMap<Client, number>();

export async function requestBackend<Result>(
  connection: BackendConnection,
  signal: AbortSignal | undefined,
  request: (client: Client, options: RequestOptions) => Promise<Result>,
  timeout = 60_000,
): Promise<Result> {
  const client = connection.client;
  if (!client) throw new Error("Backend is unavailable");
  signal?.throwIfAborted();
  const count = running.get(client) ?? 0;
  if (count >= MAX_CONCURRENT) throw new Error("Backend request limit reached");
  running.set(client, count + 1);
  try {
    return await request(client, { signal, timeout });
  } finally {
    const remaining = (running.get(client) ?? 1) - 1;
    if (remaining) running.set(client, remaining);
    else running.delete(client);
  }
}

export async function listBackendItems<T>(
  page: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor?: string }>,
): Promise<{ items: T[]; partial: boolean }> {
  const seen = new Set<string>();
  const items: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 12; i++) {
    const result = await page(cursor);
    items.push(...result.items.slice(0, Math.max(0, 2_000 - items.length)));
    cursor = result.nextCursor;
    if (!cursor) return { items, partial: items.length >= 2_000 };
    if (items.length >= 2_000 || seen.has(cursor)) break;
    seen.add(cursor);
  }
  return { items, partial: true };
}

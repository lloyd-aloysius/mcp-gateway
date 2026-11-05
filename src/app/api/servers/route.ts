import { validateBackendUrl } from "@/server/gateway/egress";
import { publicBackend } from "@/server/gateway/backend-secrets";
import { readJsonBody } from "@/server/http/json-body";
import { withAdmin } from "@/server/http/admin";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { backendServers } from "@/server/db/schema";
import { backendServerInputSchema } from "@/lib/validation";
import { addOrReplaceConnection, getConnection } from "@/server/gateway/backend-registry";

async function get() {
  const rows = await getDb().select().from(backendServers);
  return NextResponse.json(rows.map((row) => ({ ...publicBackend(row), pid: getConnection(row.id)?.pid ?? null })));
}

async function post(req: Request) {
  const body = await readJsonBody(req);
  const parsed = backendServerInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;
  if (input.connectionType !== "stdio") {
    try {
      validateBackendUrl(input.url);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid backend URL" }, { status: 400 });
    }
  }

  let row;
  try {
    [row] = await getDb()
      .insert(backendServers)
      .values({
        id: randomUUID(),
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        connectionType: input.connectionType,
        command: input.connectionType === "stdio" ? input.command : null,
        args: input.connectionType === "stdio" ? input.args : null,
        env: input.connectionType === "stdio" ? (input.env ?? null) : null,
        url: input.connectionType !== "stdio" ? input.url : null,
        headers: input.connectionType !== "stdio" ? (input.headers ?? null) : null,
        enabled: input.enabled,
        status: "disconnected",
      })
      .returning();
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed/.test(err.message)) {
      return NextResponse.json({ error: "A server with this key already exists" }, { status: 409 });
    }
    throw err;
  }

  void addOrReplaceConnection(row);

  return NextResponse.json(publicBackend(row), { status: 201 });
}

export const GET = withAdmin(get);
export const POST = withAdmin(post);

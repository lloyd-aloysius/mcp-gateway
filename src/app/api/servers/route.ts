import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { backendServers } from "@/server/db/schema";
import { backendServerInputSchema } from "@/lib/validation";
import { addOrReplaceConnection, getConnection } from "@/server/gateway/backend-registry";

export async function GET() {
  const rows = await db.select().from(backendServers);
  return NextResponse.json(rows.map((row) => ({ ...row, pid: getConnection(row.id)?.pid ?? null })));
}

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = backendServerInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  let row;
  try {
    [row] = await db
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

  return NextResponse.json(row, { status: 201 });
}

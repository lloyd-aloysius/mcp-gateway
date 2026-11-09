import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CreateMessageRequestSchema, ElicitRequestSchema, ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

const ADMIN_TOKEN = "synthetic-credential-for-local-tests-only";

const directServer = process.env.GATEWAY_TEST_SERVER_ENTRY;
const cli = process.env.GATEWAY_TEST_CLI ?? fileURLToPath(new URL("../bin/cli.mjs", import.meta.url));
const serverEntry = directServer ?? join(dirname(cli), "..", ".next", "standalone", "server.js");

async function waitFor(check, message) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await check();
    if (value) return value;
    await delay(50);
  }
  assert.fail(message);
}

test("built gateway security and startup", { timeout: 30_000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "gateway-security-"));
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  await new Promise((resolve) => listener.close(resolve));

  const base = "http://127.0.0.1:" + port;
  const env = {
    PATH: process.env.PATH,
    HOME: directory,
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    DATABASE_PATH: join(directory, "gateway.db"),
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_MANUAL_SIG_HANDLE: "1",
    MCP_GATEWAY_ADMIN_TOKEN: ADMIN_TOKEN,
    MCP_GATEWAY_INTERACTIVE_ROUTES: "interactive-one:gateway-tools,interactive-two:gateway-tools",
    MCP_GATEWAY_OAUTH_ENDPOINTS: "oauth-test",
    MCP_GATEWAY_OAUTH_RESOURCE_ORIGIN: "https://client.example.invalid",
    MCP_GATEWAY_OAUTH_ISSUER: "https://issuer.example.invalid",
    MCP_GATEWAY_OAUTH_JWKS_URL: "https://issuer.example.invalid/jwks",
    SystemRoot: process.env.SystemRoot,
  };
  const clients = [];
  let gateway;
  let exited;
  let logs = "";
  function startGateway() {
    logs = "";
    gateway = spawn(process.execPath, [directServer ?? cli], { cwd: directServer ? dirname(directServer) : directory, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    exited = once(gateway, "exit");
    gateway.stdout.on("data", (data) => { logs += data; });
    gateway.stderr.on("data", (data) => { logs += data; });
  }
  async function stopGateway() {
    await Promise.allSettled(clients.splice(0).map((client) => client.close()));
    if (gateway.exitCode !== null || gateway.signalCode !== null) return;
    gateway.kill("SIGTERM");
    const grace = new AbortController();
    try {
      await Promise.race([
        exited,
        delay(7000, undefined, { signal: grace.signal }).then(() => {
          if (process.platform !== "win32") process.kill(-gateway.pid, "SIGKILL");
          throw new Error("Gateway failed to shut down");
        }),
      ]);
    } finally {
      grace.abort();
    }
  }
  startGateway();
  t.after(async () => {
    await stopGateway();
    await rm(directory, { recursive: true, force: true });
  });

  const request = (path, method, body, headers) => fetch(base + path, {
    method,
    headers: {
      ...(path.startsWith("/api/mcp/") ? {} : { authorization: "Bearer " + ADMIN_TOKEN }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(3_000),
  });
  const json = async (path, method, body) => {
    const response = await request(path, method, body);
    assert.ok(response.ok, path + " returned " + response.status);
    return response.json();
  };
  async function waitForGateway() {
    try {
      await waitFor(() => request("/").then((response) => response.ok, () => false), "Gateway did not start. Build it first or set GATEWAY_TEST_CLI.");
    } catch (error) {
      t.diagnostic(logs);
      throw error;
    }
  }
  await waitForGateway();

  const endpoint = await json("/api/endpoints", "POST", { name: "Fixture", slug: "fixture", defaultPolicy: "allow_all" });
  const adminPath = "/api/endpoints/" + endpoint.id;
  const mcpPath = "/api/mcp/" + endpoint.slug;
  const rawSessionRequest = (token, sessionId, method = "POST") => request(mcpPath, method,
    method === "POST" ? { jsonrpc: "2.0", id: 1, method: "tools/list" } : undefined, {
      authorization: "Bearer " + token,
      "mcp-session-id": sessionId,
      accept: method === "POST" ? "application/json, text/event-stream" : "text/event-stream",
    });

  const forwarded = [];
  async function connect(token, slug = endpoint.slug, name = "security-fixture", clientId) {
    const client = new Client({ name, version: "1" }, {
      capabilities: { elicitation: { form: {} }, sampling: {} },
    });
    clients.push(client);
    client.setRequestHandler(ElicitRequestSchema, () => {
      forwarded.push("elicitation");
      return { action: "accept", content: { label: name } };
    });
    client.setRequestHandler(CreateMessageRequestSchema, () => {
      forwarded.push("sampling");
      return { role: "assistant", model: "fixture", content: { type: "text", text: name } };
    });
    const transport = new StreamableHTTPClientTransport(new URL(base + "/api/mcp/" + slug), {
      requestInit: { headers: { authorization: "Bearer " + token, ...(clientId ? { "X-MCP-Client-Id": clientId } : {}) } },
    });
    await client.connect(transport);
    return { client, sessionId: transport.sessionId };
  }

  await t.test("admin credentials, trusted origins and request limits are enforced", async () => {
    assert.equal((await request("/")).status, 200);
    const anonymous = await fetch(base, { redirect: "manual" });
    assert.equal(anonymous.status, 307);
    assert.equal(new URL(anonymous.headers.get("location"), base).href, base + "/login");
    assert.equal(anonymous.headers.has("www-authenticate"), false);
    assert.equal((await request("/api/health", "GET", undefined, { authorization: "" })).status, 200);
    for (const path of ["/api/servers", "/api/endpoints", "/api/audit/export", "/api/events/stream"]) {
      assert.equal((await request(path, "GET", undefined, { authorization: "Bearer " + endpoint.token })).status, 401);
    }
    const basic = "Basic " + Buffer.from("admin:" + ADMIN_TOKEN).toString("base64");
    assert.equal((await request("/api/servers", "GET", undefined, { authorization: basic })).status, 401);
    assert.equal((await request("/api/endpoints", "POST", {}, { origin: "https://foreign.invalid" })).status, 403);
    assert.equal((await request(mcpPath, "GET", undefined, {
      authorization: "Bearer " + endpoint.token, origin: "https://foreign.invalid",
    })).status, 403);
    assert.equal((await request("/api/endpoints", "POST", "x".repeat(128 * 1024))).status, 413);
    assert.equal((await request(mcpPath, "POST", Array.from({ length: 17 }, () => ({})), {
      authorization: "Bearer " + endpoint.token, accept: "application/json, text/event-stream",
    })).status, 413);
  });

  await t.test("client names persist per endpoint and reject unauthorized or malformed updates", async () => {
    const first = await json(adminPath + "/clients", "POST", { clientId: "identity-fixture" });
    const otherEndpoint = await json("/api/endpoints", "POST", { name: "Other client scope", slug: "identity-scope", defaultPolicy: "deny_all" });
    const other = await json("/api/endpoints/" + otherEndpoint.id + "/clients", "POST", { clientId: "identity-fixture" });
    const payload = { id: first.id, label: "  Codex Mac  " };
    assert.equal((await request("/api/endpoints/clients", "PATCH", payload, { authorization: "" })).status, 401);
    assert.equal((await request("/api/endpoints/clients", "PATCH", payload, { authorization: "Bearer " + endpoint.token })).status, 401);
    assert.equal((await request("/api/endpoints/clients", "PATCH", payload, { origin: "https://foreign.invalid" })).status, 403);
    assert.equal((await request("/api/endpoints/clients", "PATCH", { ...payload, label: "x".repeat(121) })).status, 400);
    assert.equal((await request("/api/endpoints/clients", "PATCH", { ...payload, clientId: "changed" })).status, 400);
    assert.equal((await request("/api/endpoints/clients", "PATCH", { ...payload, id: "missing" })).status, 404);
    const saved = await json("/api/endpoints/clients", "PATCH", payload);
    assert.equal(saved.label, "Codex Mac");
    assert.equal(saved.clientId, first.clientId);
    const rows = await json("/api/endpoints/clients");
    assert.equal(rows.find((row) => row.id === first.id).label, "Codex Mac");
    assert.equal(rows.find((row) => row.id === other.id).label, null);
    assert.equal((await json("/api/endpoints/clients", "PATCH", { id: first.id, label: " " })).label, null);
  });

  await t.test("client logos persist and removing a profile preserves access/history and rediscovers on the next call", async () => {
    const otherEndpoint = await json("/api/endpoints", "POST", { name: "Profile isolation", slug: "profile-isolation", defaultPolicy: "allow_all" });
    const duplicate = await json("/api/endpoints/" + otherEndpoint.id + "/clients", "POST", { clientId: "profile-fixture", label: "Other profile", icon: "bot" });
    const profile = await json(adminPath + "/clients", "POST", { clientId: "profile-fixture", label: "  My assistant  ", icon: "hermes" });
    assert.equal(profile.label, "My assistant");
    assert.equal(profile.icon, "hermes");
    assert.equal((await request("/api/endpoints/missing/clients", "POST", { clientId: "x" })).status, 404);
    assert.equal((await request(adminPath + "/clients", "POST", { clientId: "bad\nheader" })).status, 400);
    assert.equal((await request(adminPath + "/clients", "POST", { clientId: "bad-icon", icon: "https://untrusted.invalid/icon.svg" })).status, 400);
    assert.equal((await request("/api/endpoints/clients", "PATCH", { id: profile.id, icon: "not-a-preset" })).status, 400);
    assert.equal((await request("/api/endpoints/clients", "PATCH", { id: profile.id })).status, 400);
    const renamed = await json("/api/endpoints/clients", "PATCH", { id: profile.id, label: "Codex custom" });
    assert.equal(renamed.icon, "hermes");
    assert.equal(renamed.clientId, "profile-fixture");
    await stopGateway(); startGateway(); await waitForGateway();
    assert.equal((await json("/api/endpoints/clients")).find((c) => c.id === profile.id).icon, "hermes");
    const { client } = await connect(endpoint.token, endpoint.slug, "profile-fixture", "profile-fixture");
    try {
      const result = await client.callTool({ name: "gateway-tools__ping", arguments: {} });
      assert.ok(!result.isError);
      assert.equal((await json("/api/endpoints/clients")).find((c) => c.id === profile.id).icon, "hermes");
      const beforeAudit = await json("/api/audit?clientId=profile-fixture&endpointId=" + endpoint.id);
      assert.ok(beforeAudit.rows.length > 0);
      const beforeEndpoint = await json(adminPath);
      for (const headers of [{ authorization: "" }, { authorization: "Bearer " + endpoint.token }]) {
        assert.equal((await request("/api/endpoints/clients", "DELETE", { id: profile.id }, headers)).status, 401);
      }
      assert.equal((await request("/api/endpoints/clients", "DELETE", { id: profile.id }, { origin: "https://foreign.invalid" })).status, 403);
      assert.equal((await request("/api/endpoints/clients", "DELETE", { id: profile.id, clientId: "other" })).status, 400);
      assert.equal((await request("/api/endpoints/clients", "DELETE", { id: "missing" })).status, 404);
      await json("/api/endpoints/clients", "DELETE", { id: profile.id });
      const remaining = await json("/api/endpoints/clients");
      assert.ok(!remaining.some((c) => c.id === profile.id));
      assert.equal(remaining.find((c) => c.id === duplicate.id).icon, "bot");
      const afterAudit = await json("/api/audit?clientId=profile-fixture&endpointId=" + endpoint.id);
      assert.deepEqual(afterAudit.rows, beforeAudit.rows);
      const afterEndpoint = await json(adminPath);
      for (const field of ["id", "slug", "tokenPrefix", "defaultPolicy", "enabled"]) assert.equal(afterEndpoint[field], beforeEndpoint[field], field);
      assert.ok(!(await client.callTool({ name: "gateway-tools__ping", arguments: {} })).isError);
      const rediscovered = (await json("/api/endpoints/clients")).find((c) => c.endpointId === endpoint.id && c.clientId === "profile-fixture");
      assert.ok(rediscovered && rediscovered.id !== profile.id);
      assert.equal(rediscovered.icon, "auto");
      assert.equal(rediscovered.label, null);
    } finally { await client.close(); }
  });

  await t.test("browser sign-in issues a revocable session and protects mutations from cross-origin requests", async () => {
    assert.equal((await request("/login", "GET", undefined, { authorization: "" })).status, 200);
    const login = (password, origin = base) => request("/api/admin/session", "POST", { password }, {
      authorization: "", origin,
    });
    assert.equal((await login(ADMIN_TOKEN, "https://foreign.invalid")).status, 403);
    assert.equal((await login(endpoint.token)).status, 401);
    const signedIn = await login(ADMIN_TOKEN);
    assert.equal(signedIn.status, 204);
    const cookie = signedIn.headers.get("set-cookie");
    assert.match(cookie, /HttpOnly; SameSite=Strict/);
    assert.ok(!cookie.includes(ADMIN_TOKEN));
    const session = { authorization: "", cookie: cookie.split(";")[0] };
    assert.equal((await request("/", "GET", undefined, session)).status, 200);
    assert.equal((await request("/api/servers", "GET", undefined, session)).status, 200);
    assert.equal((await request("/api/endpoints", "POST", {}, session)).status, 403);
    assert.equal((await request("/api/endpoints/clients", "DELETE", { id: "missing" }, session)).status, 403);
    assert.equal((await request("/api/admin/session", "DELETE", undefined, {
      ...session, origin: "https://foreign.invalid",
    })).status, 403);
    const signedOut = await request("/api/admin/session", "DELETE", undefined, { ...session, origin: base });
    assert.equal(signedOut.status, 204);
    assert.match(signedOut.headers.get("set-cookie"), /Max-Age=0/);
    assert.equal((await request("/api/servers", "GET", undefined, session)).status, 401);
  });

  const first = await connect(endpoint.token);
  const ping = "gateway-tools__ping";
  const registration = "gateway-tools__add_backend_server";
  const toolNames = async (client) => (await client.listTools()).tools.map((tool) => tool.name);

  await t.test("diagnostics work after cold boot without a manual reconnect", async () => {
    assert.deepEqual((await toolNames(first.client)).sort(), [
      "gateway-tools__gateway_status", "gateway-tools__list_backend_servers", ping,
    ]);
    assert.match((await first.client.callTool({ name: ping })).content[0].text, /pong/);
  });

  let builtinId;
  await t.test("legacy backend registration stays hidden and blocked, and callbacks stay local", async () => {
    const fixture = join(directory, "legacy.mjs");
    await writeFile(fixture, `
      import { Server } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/index.js"))};
      import { StdioServerTransport } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/stdio.js"))};
      import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, ReadResourceRequestSchema } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/types.js"))};
      const server = new Server({ name: "legacy", version: "1" }, { capabilities: { tools: { listChanged: true }, resources: {} } });
      let arrivalCount = 0;
      let bothArrived;
      const overlap = new Promise((resolve) => { bothArrived = resolve; });
      server.setRequestHandler(ListToolsRequestSchema, ({ params }) => ({
        tools: (params?.cursor === "more" ? ["fail", "relay", "change"] : ["ping", "interactive", "add_backend_server"])
          .map((name) => ({ name, inputSchema: { type: "object" } })),
        ...(params?.cursor ? {} : { nextCursor: "more" }),
      }));
      server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: [] }));
      server.setRequestHandler(ListResourceTemplatesRequestSchema, () => ({
        resourceTemplates: [{ name: "fixture", uriTemplate: "fixture://item/{name}" }],
      }));
      server.setRequestHandler(ReadResourceRequestSchema, ({ params }) => ({
        contents: [{ uri: params.uri, text: params.uri }],
      }));
      server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
        if (params.name === "change") {
          await server.sendToolListChanged();
          return { content: [{ type: "text", text: "changed" }] };
        }
        if (params.name === "relay") {
          const answer = await server.elicitInput({ mode: "form", message: "Synthetic form",
            requestedSchema: { type: "object", properties: { label: { type: "string" } } } });
          const sample = await server.createMessage({ messages: [{ role: "user", content: { type: "text", text: "Synthetic sample" } }], maxTokens: 4 });
          return { content: [{ type: "text", text: JSON.stringify([answer.content.label, sample.content.text]) }] };
        }
        if (params.name === "fail") return { isError: true, content: [{ type: "text", text: "Synthetic failure" }] };
        if (params.name !== "interactive") return { content: [{ type: "text", text: params.name }] };
        if (++arrivalCount === 2) bothArrived();
        await overlap;
        const results = await Promise.allSettled([
          server.elicitInput({ mode: "form", message: "Synthetic form", requestedSchema: { type: "object", properties: {} } }),
          server.createMessage({ messages: [{ role: "user", content: { type: "text", text: "Synthetic sample" } }], maxTokens: 4 }),
        ]);
        return { content: [{ type: "text", text: JSON.stringify(results.map((result) => result.status)) }] };
      });
      await server.connect(new StdioServerTransport());
    `);

    const servers = await json("/api/servers");
    const builtin = servers.find((row) => row.key === "gateway-tools");
    assert.ok(builtin?.pid);
    builtinId = builtin.id;
    const updated = await json("/api/servers/" + builtin.id, "PATCH", {
      command: process.execPath, args: [fixture], env: { FIXTURE_SECRET: "never-return-this-value" },
    });
    assert.equal(updated.env.FIXTURE_SECRET, "");
    assert.equal((await json("/api/servers/" + builtin.id)).env.FIXTURE_SECRET, "");
    const interactive = "gateway-tools__interactive";
    const legacyTools = await waitFor(async () => {
      const names = await toolNames(first.client);
      return names.includes(interactive) && names;
    }, "Fixture backend did not connect after the admin edit");
    assert.ok(!legacyTools.includes(registration));
    await assert.rejects(first.client.callTool({ name: registration }), /Tool disabled/);

    const second = await connect(endpoint.token);
    const results = await Promise.all([first, second].map(({ client }) => client.callTool({ name: interactive })));
    for (const result of results) {
      assert.deepEqual(JSON.parse(result.content[0].text), ["rejected", "rejected"]);
    }
    assert.deepEqual(forwarded, []);
  });

  await t.test("opt-in callbacks reach only the originating client and request", async () => {
    const paths = ["interactive-one", "interactive-two"];
    const endpoints = await Promise.all(paths.map((slug) => json("/api/endpoints", "POST",
      { name: slug, slug, defaultPolicy: "allow_all" })));
    const paired = await Promise.all(endpoints.map(({ token, slug }) => connect(token, slug, slug)));
    const results = await Promise.all(paired.map(({ client }) => client.callTool({ name: "gateway-tools__relay" })));
    assert.deepEqual(results.map((result) => JSON.parse(result.content[0].text)), paths.map((name) => [name, name]));
  });

  await t.test("OAuth-only endpoints advertise their issuer and reject a static bearer", async () => {
    const oauth = await json("/api/endpoints", "POST", { name: "OAuth fixture", slug: "oauth-test" });
    const discovery = await request("/.well-known/oauth-protected-resource/api/mcp/oauth-test", "GET", undefined, { authorization: "" });
    assert.equal(discovery.status, 200);
    const metadata = await discovery.json();
    assert.equal(metadata.resource, "https://client.example.invalid/api/mcp/oauth-test");
    assert.deepEqual(metadata.scopes_supported, ["mcp:oauth-test"]);
    const denied = await request("/api/mcp/oauth-test", "GET", undefined, { authorization: "" });
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get("www-authenticate"), /resource_metadata=/);
    assert.equal((await request("/api/mcp/oauth-test", "GET", undefined, {
      authorization: "Bearer " + oauth.token,
    })).status, 401);
  });

  await t.test("resource templates expand without losing the upstream URI and inventory changes relay", async () => {
    const templates = await first.client.listResourceTemplates();
    const uri = templates.resourceTemplates[0].uriTemplate.replace("{name}", "a%2Fb");
    const result = await first.client.readResource({ uri });
    assert.equal(result.contents[0].text, "fixture://item/a%2Fb");
    const notice = new Promise((resolve) => first.client.setNotificationHandler(ToolListChangedNotificationSchema, resolve));
    await first.client.callTool({ name: "gateway-tools__change" });
    assert.ok(await Promise.race([notice, delay(1000).then(() => null)]), "list-changed notification was not received");
  });

  await t.test("paginated tools, per-tool grants, audit privacy, and export use live gateway behavior", async () => {
    const fail = "gateway-tools__fail";
    assert.ok((await toolNames(first.client)).includes(fail));
    await json(adminPath, "PATCH", { name: "=1+1" });
    const failure = await first.client.callTool({ name: fail, arguments: { note: "must-not-be-logged" } });
    assert.equal(failure.isError, true);
    const { rows } = await json("/api/audit?itemName=" + fail);
    assert.equal(rows[0].status, "error");
    assert.equal(rows[0].requestArgsJson, null);
    const csv = await (await request("/api/audit/export")).text();
    assert.match(csv, /,'=1\+1,/);
    assert.match(csv, /admin\/change/);
    const policy = adminPath + "/tool-policy";
    await json(policy, "PUT", { backendServerId: builtinId, toolName: "ping", access: "allow" });
    assert.deepEqual(await toolNames(first.client), [ping]);
    await assert.rejects(first.client.callTool({ name: fail }), /outside the endpoint allowlist/);
    const preview = await json(policy + "?backendServerId=" + builtinId);
    assert.equal(preview.tools.find((tool) => tool.name === "fail")?.effective, "deny");
    await json(policy, "PUT", { backendServerId: builtinId, toolName: "ping", access: "inherit" });
    assert.deepEqual(await toolNames(first.client), []);
    await json(policy, "PUT", { backendServerId: builtinId, mode: "inherit" });
  });

  await t.test("versioned configuration preview and private egress policy", async () => {
    const config = { version: 1, backends: [{ key: "fixture-import", name: "Import fixture",
      connectionType: "http", url: "https://example.invalid/mcp", enabled: false }] };
    const plan = await json("/api/settings/config", "POST", config);
    assert.equal(plan.applied, false);
    assert.ok(!(await json("/api/servers")).some((server) => server.key === "fixture-import"));
    assert.equal((await json("/api/settings/config?apply=1", "POST", config)).applied, true);
    assert.ok((await json("/api/settings/config")).backends.some((server) => server.key === "fixture-import"));
    config.backends[0].url = "https://127.0.0.1/mcp";
    assert.equal((await request("/api/settings/config", "POST", config)).status, 400);
    const readiness = await json("/api/settings/health");
    assert.equal(readiness.ready, true);
    assert.equal(readiness.auditRetentionDays, 30);
    assert.equal(readiness.auditMaxRows, 100_000);
    assert.match(await (await request("/api/settings/metrics")).text(), /mcp_gateway_ready 1/);
  });

  await t.test("live sessions enforce current policy and credential rotation closes streams", async () => {
    await json(adminPath, "PATCH", { defaultPolicy: "deny_all" });
    assert.deepEqual(await toolNames(first.client), []);
    await assert.rejects(first.client.callTool({ name: ping }), /Access denied/);

    // Use a raw session so the SDK does not automatically open its own SSE stream.
    const initialized = await request(mcpPath, "POST", {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-11-25", clientInfo: { name: "raw", version: "1" }, capabilities: {} },
    }, { authorization: "Bearer " + endpoint.token, accept: "application/json, text/event-stream" });
    assert.equal(initialized.status, 200);
    const streamSession = initialized.headers.get("mcp-session-id");
    assert.ok(streamSession);
    await initialized.text();

    // The server accepts one stream and rejects the duplicate. Next.js can
    // buffer the accepted stream's headers until it writes or closes the body.
    const streamRequests = Array.from({ length: 2 }, () => rawSessionRequest(endpoint.token, streamSession, "GET"));
    assert.equal((await Promise.race(streamRequests)).status, 409);
    const rotated = await json(adminPath + "/regenerate-token", "POST");
    assert.equal((await rawSessionRequest(endpoint.token, first.sessionId)).status, 401);
    assert.equal((await rawSessionRequest(rotated.token, first.sessionId)).status, 404);
    const streams = await Promise.all(streamRequests);
    const closedStream = streams.find((response) => response.status === 200);
    assert.ok(closedStream, "The previously accepted SSE stream should close on token rotation");
    assert.equal(await closedStream.text(), "");

    const current = await connect(rotated.token);
    const disabled = await json(adminPath, "PATCH", { enabled: false, defaultPolicy: "allow_all" });
    assert.equal(disabled.enabled, false);
    const renamed = await json(adminPath, "PATCH", { name: "Renamed" });
    assert.equal(renamed.enabled, false);
    assert.equal(renamed.defaultPolicy, "allow_all");
    assert.equal((await rawSessionRequest(rotated.token, current.sessionId)).status, 403);
    await json(adminPath, "PATCH", { enabled: true });
    assert.equal((await rawSessionRequest(rotated.token, current.sessionId)).status, 404);

    const final = await connect(rotated.token);
    assert.ok((await toolNames(final.client)).includes(ping));
    await json(adminPath, "DELETE");
    assert.equal((await rawSessionRequest(rotated.token, final.sessionId)).status, 404);
  });

  await t.test("an endpoint cannot exceed its session or request budget", async () => {
    const limited = await json("/api/endpoints", "POST", { name: "Limited", slug: "limited" });
    const path = "/api/mcp/" + limited.slug;
    const headers = { authorization: "Bearer " + limited.token, accept: "application/json, text/event-stream" };
    const initialize = () => request(path, "POST", {
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-11-25", clientInfo: { name: "capacity", version: "1" }, capabilities: {} },
    }, headers);
    for (let start = 0; start < 64; start += 8) {
      const group = await Promise.all(Array.from({ length: 8 }, initialize));
      assert.ok(group.every((response) => response.status === 200));
      await Promise.all(group.map((response) => response.text()));
    }
    assert.equal((await initialize()).status, 429);
    for (let total = 65; total < 360; total += 20) {
      const requests = Array.from({ length: Math.min(20, 360 - total) }, () => request(path, "GET", undefined, headers));
      assert.ok((await Promise.all(requests)).every((response) => response.status === 400));
    }
    const throttled = await request(path, "GET", undefined, headers);
    assert.equal(throttled.status, 429);
    assert.equal(throttled.headers.get("retry-after"), "60");
    await json("/api/endpoints/" + limited.id, "DELETE");
  });

  await t.test("restores a live SQLite backup and restarts without orphaned backends", async () => {
    const oldServer = (await json("/api/servers")).find((row) => row.id === builtinId);
    assert.ok(oldServer.pid);
    const snapshot = join(directory, "restored.db");
    const Database = createRequire(serverEntry)("better-sqlite3");
    const source = new Database(env.DATABASE_PATH, { readonly: true });
    try {
      await source.backup(snapshot);
    } finally {
      source.close();
    }
    const copy = new Database(snapshot, { readonly: true });
    try {
      assert.equal(copy.pragma("integrity_check", { simple: true }), "ok");
    } finally {
      copy.close();
    }
    await stopGateway();
    if (process.platform !== "win32") {
      assert.throws(() => process.kill(oldServer.pid, 0), { code: "ESRCH" });
    }
    env.DATABASE_PATH = snapshot;
    startGateway();
    await waitForGateway();
    const newEndpoint = await json("/api/endpoints", "POST", { name: "Restart", slug: endpoint.slug, defaultPolicy: "allow_all" });
    const restarted = await connect(newEndpoint.token);
    assert.ok((await toolNames(restarted.client)).includes(ping));
    assert.equal((await restarted.client.callTool({ name: ping })).content[0].text, "ping");
  });
  await t.test("upgrading a populated 0.2.0 database preserves configuration and history", async () => {
    await stopGateway();

    const migrations = join(dirname(serverEntry), "drizzle");
    const legacyMigrations = join(directory, "legacy-migrations");
    const journal = JSON.parse(await readFile(join(migrations, "meta", "_journal.json"), "utf8"));
    journal.entries = journal.entries.filter(({ idx }) => idx < 2);
    assert.equal(journal.entries.length, 2);
    await mkdir(join(legacyMigrations, "meta"), { recursive: true });
    await writeFile(join(legacyMigrations, "meta", "_journal.json"), JSON.stringify(journal));
    for (const entry of journal.entries) {
      const file = entry.tag + ".sql";
      await copyFile(join(migrations, file), join(legacyMigrations, file));
    }

    const connector = join(directory, "preserved-connector.mjs");
    await writeFile(connector, `
      import { Server } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/index.js"))};
      import { StdioServerTransport } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/server/stdio.js"))};
      import { CallToolRequestSchema, ListToolsRequestSchema } from ${JSON.stringify(import.meta.resolve("@modelcontextprotocol/sdk/types.js"))};
      const server = new Server({ name: "preserved", version: "1" }, { capabilities: { tools: {} } });
      server.setRequestHandler(ListToolsRequestSchema, () => ({
        tools: ["read", "blocked"].map(name => ({ name, inputSchema: { type: "object" } })),
      }));
      server.setRequestHandler(CallToolRequestSchema, () => ({
        content: [{ type: "text", text: process.env.CONNECTOR_SECRET === "synthetic-stored-secret" ? "configured" : "missing" }],
      }));
      await server.connect(new StdioServerTransport());
    `);
    const Database = createRequire(serverEntry)("better-sqlite3");
    const legacyPath = join(directory, "before-upgrade.db");
    const upgradedPath = join(directory, "after-upgrade.db");
    const previousToken = "gwy_fixture-existing-token-used-only-in-this-test";
    const previousHash = createHash("sha256").update(previousToken).digest("hex");
    const old = Date.now() - 400 * 24 * 60 * 60_000;
    const queries = [
      "SELECT id, key, name, connection_type, command, args, env, url, headers, enabled FROM backend_servers WHERE id LIKE 'legacy-%' ORDER BY id",
      "SELECT id, name, slug, token_hash, token_prefix, default_policy, enabled FROM client_endpoints WHERE id = 'legacy-endpoint'",
      "SELECT * FROM endpoint_server_rules WHERE endpoint_id = 'legacy-endpoint' ORDER BY id",
      "SELECT * FROM backend_server_tools WHERE backend_server_id = 'legacy-stdio'",
      "SELECT id, endpoint_id, client_id, label, first_seen_at, last_seen_at FROM endpoint_clients WHERE id = 'legacy-client'",
      "SELECT * FROM app_settings WHERE key = 'legacy-custom-setting'",
      "SELECT * FROM audit_log WHERE item_name = 'legacy-audit-record'",
    ];
    const state = (db) => queries.map((query) => db.prepare(query).all());
    const legacy = new Database(legacyPath);
    let before;
    try {
      legacy.pragma("foreign_keys = ON");
      migrate(drizzle(legacy), { migrationsFolder: legacyMigrations });
      const createBackend = legacy.prepare(`
        INSERT INTO backend_servers (id, key, name, connection_type, command, args, env, url, headers, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      createBackend.run("legacy-stdio", "existing", "Existing connector", "stdio",
        process.execPath, JSON.stringify([connector]), JSON.stringify({ CONNECTOR_SECRET: "synthetic-stored-secret" }), null, null, 1);
      createBackend.run("legacy-remote", "remote", "Existing remote", "http",
        null, null, null, "http://127.0.0.1:1/mcp", JSON.stringify({ Authorization: "Bearer synthetic-remote" }), 0);
      legacy.prepare(`INSERT INTO client_endpoints (id, name, slug, token_hash, token_prefix, default_policy)
        VALUES ('legacy-endpoint', 'Existing endpoint', 'legacy', ?, ?, 'deny_all')`)
        .run(previousHash, previousToken.slice(0, 12));
      legacy.exec(`
        INSERT INTO endpoint_server_rules (id, endpoint_id, backend_server_id, access)
          VALUES ('existing-allow', 'legacy-endpoint', 'legacy-stdio', 'allow'),
                 ('existing-deny', 'legacy-endpoint', 'legacy-remote', 'deny');
        INSERT INTO backend_server_tools (id, backend_server_id, tool_name, enabled)
          VALUES ('existing-toggle', 'legacy-stdio', 'blocked', 0);
        INSERT INTO app_settings (key, value) VALUES ('legacy-custom-setting', 'preserve-me');
      `);
      legacy.prepare(`INSERT INTO endpoint_clients (id, endpoint_id, client_id, label, first_seen_at, last_seen_at)
        VALUES ('legacy-client', 'legacy-endpoint', 'existing-client', 'Saved client', ?, ?)`).run(old, old);
      legacy.prepare(`INSERT INTO audit_log (timestamp, endpoint_id, backend_server_id, item_name, operation_type, status)
        VALUES (?, 'legacy-endpoint', 'legacy-stdio', 'legacy-audit-record', 'tools/call', 'success')`).run(old);
      before = state(legacy);
      assert.ok(before.every((rows) => rows.length > 0));
      await legacy.backup(upgradedPath);
    } finally {
      legacy.close();
    }

    env.DATABASE_PATH = upgradedPath;
    startGateway();
    await waitForGateway();
    const upgraded = new Database(upgradedPath, { readonly: true });
    try {
      assert.deepEqual(state(upgraded), before);
      assert.equal(upgraded.prepare("SELECT icon FROM endpoint_clients WHERE id = 'legacy-client'").get().icon, "auto");
      assert.deepEqual(upgraded.pragma("foreign_key_check"), []);
    } finally {
      upgraded.close();
    }
    const saved = await connect(previousToken, "legacy");
    assert.deepEqual(await toolNames(saved.client), ["existing__read"]);
    assert.equal((await saved.client.callTool({ name: "existing__read" })).content[0].text, "configured");
    await assert.rejects(saved.client.callTool({ name: "existing__blocked" }), /Tool disabled/);
    const health = await json("/api/settings/health");
    assert.equal(health.auditRetentionDays, null);
    assert.equal(health.auditMaxRows, null);

    // Opt-in audit retention still prunes audit rows, while saved clients
    // and the original backup remain available for an upgrade rollback.
    await stopGateway();
    env.MCP_GATEWAY_AUDIT_RETENTION_DAYS = "30";
    startGateway();
    await waitForGateway();
    const retained = new Database(upgradedPath, { readonly: true });
    const original = new Database(legacyPath, { readonly: true });
    try {
      assert.deepEqual(retained.prepare(queries[4]).all(), before[4]);
      assert.deepEqual(retained.prepare(queries[6]).all(), []);
      assert.deepEqual(state(original), before);
    } finally {
      retained.close();
      original.close();
    }
  });

});

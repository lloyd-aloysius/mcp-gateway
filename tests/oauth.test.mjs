import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { verifyAccessToken } from "../src/server/gateway/oauth.ts";
import { backendFetch, validateBackendUrl } from "../src/server/gateway/egress.ts";
import { stdioLaunch } from "../src/server/gateway/stdio-launch.ts";

test("OAuth accepts only a signed, short-lived access token for the exact resource and scope", async () => {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  const keys = createLocalJWKSet({ keys: [jwk] });
  const resource = new URL("https://mcp.example.invalid/api/mcp/fixture");
  const config = {
    issuer: "https://issuer.example.invalid", resource, scope: "mcp:fixture",
    metadata: new URL("https://mcp.example.invalid/.well-known/oauth-protected-resource/api/mcp/fixture"),
    jwks: new URL("https://issuer.example.invalid/jwks"),
  };

  function sign({ audience = resource.href, scope = config.scope, issuer = config.issuer,
    type = "at+jwt", expires = "5m" } = {}) {
    return new SignJWT({ scope, client_id: "fixture-client" })
      .setProtectedHeader({ alg: "ES256", typ: type })
      .setIssuer(issuer)
      .setSubject("fixture-user")
      .setJti("fixture-token")
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expires)
      .sign(privateKey);
  }

  assert.equal((await verifyAccessToken(await sign(), config, keys)).scopeGranted, true);
  assert.equal((await verifyAccessToken(await sign({ scope: "mcp:other" }), config, keys)).scopeGranted, false);
  for (const parameters of [
    { audience: "https://another.example.invalid/api/mcp/fixture" },
    { issuer: "https://another.example.invalid" },
    { type: "JWT" },
    { expires: "20m" },
    { expires: 1 },
  ]) {
    await assert.rejects(verifyAccessToken(await sign(parameters), config, keys));
  }
});

test("sandbox opt-in requires an absolute operator launcher and connector", (t) => {
  const previous = {
    backends: process.env.MCP_GATEWAY_SANDBOX_BACKENDS,
    launcher: process.env.MCP_GATEWAY_STDIO_LAUNCHER,
  };
  t.after(() => {
    for (const [key, value] of [
      ["MCP_GATEWAY_SANDBOX_BACKENDS", previous.backends],
      ["MCP_GATEWAY_STDIO_LAUNCHER", previous.launcher],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.MCP_GATEWAY_SANDBOX_BACKENDS = "private-connector";
  delete process.env.MCP_GATEWAY_STDIO_LAUNCHER;
  assert.throws(() => stdioLaunch("private-connector", process.execPath, []), /absolute/);
  process.env.MCP_GATEWAY_STDIO_LAUNCHER = process.execPath;
  assert.throws(() => stdioLaunch("private-connector", "node", []), /absolute/);
  assert.deepEqual(stdioLaunch("private-connector", process.execPath, ["arg"]),
    { command: process.execPath, args: [process.execPath, "arg"] });
  assert.deepEqual(stdioLaunch("public-connector", "node", ["arg"]), { command: "node", args: ["arg"] });
});

test("backend fetch rejects private targets by default and never follows a redirect", async (t) => {
  const previous = process.env.MCP_GATEWAY_PRIVATE_BACKEND_ORIGINS;
  t.after(() => {
    if (previous === undefined) delete process.env.MCP_GATEWAY_PRIVATE_BACKEND_ORIGINS;
    else process.env.MCP_GATEWAY_PRIVATE_BACKEND_ORIGINS = previous;
  });
  delete process.env.MCP_GATEWAY_PRIVATE_BACKEND_ORIGINS;
  assert.throws(() => validateBackendUrl("https://[::ffff:127.0.0.1]/mcp"), /allowlist/);
  assert.throws(() => validateBackendUrl("https://user:secret@example.invalid/mcp"), /credentials/);

  let followed = false;
  const server = createServer((req, res) => {
    if (req.url === "/redirect") res.writeHead(302, { location: "/unexpected" }).end();
    else {
      followed = true;
      res.end("unexpected");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = "http://127.0.0.1:" + server.address().port;
  process.env.MCP_GATEWAY_PRIVATE_BACKEND_ORIGINS = origin;
  const fetchBackend = backendFetch(origin);
  assert.throws(() => fetchBackend("https://example.invalid/other"), /Cross-origin/);
  await assert.rejects(fetchBackend(origin + "/redirect"));
  assert.equal(followed, false);
});

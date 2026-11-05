# Personal deployment and recovery

Run the gateway as one persistent process under a dedicated account. Use a pinned package version or container digest and record the source commit. Allow client identities to reach the MCP hostname. Restrict the admin hostname to your devices using firewall rules, an identity-aware proxy, or tailnet grants.

## First start

1. Copy `.env.example` to `.env` and set its mode to `0600`. Generate a strong `MCP_GATEWAY_ADMIN_TOKEN` and set `MCP_GATEWAY_ADMIN_ORIGINS` to the exact dashboard origin. Use the username `admin` and the configured token in the browser prompt. Admin scripts may use the same token as a bearer credential.
2. Use the default loopback bind for a host installation. For Docker, run `docker compose -f docs/deployment/compose.yaml up -d --build`. The example publishes port 3000 to the host loopback and gives the nonroot service a private data volume. An existing volume owned by root requires an ownership migration to the service UID before the first start.
3. Configure TLS and the two hostnames using the [nginx example](nginx.conf). Set `MCP_GATEWAY_PUBLIC_MCP_ORIGIN` to the client hostname so the dashboard generates the correct client URL. Keep direct origin access restricted to the proxy. Verify that a client device reaches the MCP endpoint and receives 404 for admin paths on its MCP hostname. Verify the admin hostname rejects requests without credentials.
4. Configure private backend origins explicitly in `MCP_GATEWAY_PRIVATE_BACKEND_ORIGINS`. Prefer write-only header and environment values such as `${env:MCP_BACKEND_SECRET_GITHUB}`. Launch only trusted, pinned stdio programs. Use a separate restricted account or container for third-party connectors with broader process needs.
5. Set up a deny-by-default endpoint for each trust class and grant the required backends and tools. Use the endpoint’s config panel and confirm a real client can list and call an allowed tool.

## Health checks

Use `/api/health` as a liveness probe. The admin-authenticated `/api/settings/health` returns 503 when an enabled backend is unavailable and reports recent tool outcomes. Protect the admin token in your monitoring system. An OpenTelemetry Collector can use its Prometheus receiver to scrape the authenticated `/api/settings/metrics` endpoint. Monitor disk space, reconnect churn, and tool failure rates.

## Backup, restore and rollback

Run SQLite’s online backup on the database host with the service account or another authorized operator. Keep the backup directory private and use a new destination for each snapshot. The backup API reads a consistent snapshot including committed WAL data.

```sh
umask 077
sqlite3 /path/to/gateway.db ".backup '/private/backup/gateway-before-upgrade.db'"
sqlite3 -readonly /private/backup/gateway-before-upgrade.db 'PRAGMA integrity_check;'
sqlite3 -readonly -header -column /private/backup/gateway-before-upgrade.db "
  SELECT 'backends' AS category, count(*) AS records FROM backend_servers
  UNION ALL SELECT 'endpoints', count(*) FROM client_endpoints
  UNION ALL SELECT 'access rules', count(*) FROM endpoint_server_rules
  UNION ALL SELECT 'tool switches', count(*) FROM backend_server_tools
  UNION ALL SELECT 'saved clients', count(*) FROM endpoint_clients
  UNION ALL SELECT 'audit entries', count(*) FROM audit_log;
"
```

### Upgrading an existing installation

1. Record the running package version or image digest, the exact SQLite path and volume, and the service user. Back up the service environment, proxy configuration and any connector credential or executable files separately. Store these with the SQLite snapshot in private storage. The dashboard configuration export covers backend definitions and secret references.
2. Make an online SQLite backup using the command above. Verify its integrity and keep an untouched copy for rollback. The snapshot contains backend settings, stored credentials, endpoint IDs and token hashes, access rules, tool switches, saved clients, and audit history.
3. Rehearse on another copy and a separate loopback port. Use fixture credentials and disable or replace real connectors in the rehearsal copy before starting the candidate. Compare the saved configuration before and after migration and test discovery, an allowed call, restart, and audit export.
4. Prepare the new admin credential and trusted admin origin. List the exact scheme, hostname and port of any existing private or plain HTTP connector origins in `MCP_GATEWAY_PRIVATE_BACKEND_ORIGINS`. Verify the service account can read its connector files and write the data volume. Keep the existing public MCP origin, endpoint slugs, authentication mode and bearer tokens for already-configured clients.
5. At cutover, stop the old process before starting the new one on the same database. Keep the verified pre-upgrade snapshot and previous executable available. Verify readiness, an allowed call from each client trust class, and denial of admin access from the client ingress.

The upgrade keeps existing audit history by default. New installations keep up to 30 days and 100,000 audit rows. You can set `MCP_GATEWAY_AUDIT_RETENTION_DAYS` and `MCP_GATEWAY_AUDIT_MAX_ROWS` separately. A value of `0` disables that limit. Setting a positive limit lets maintenance remove audit rows during startup. Saved client records are kept independently of audit retention.

To roll back, stop the new process and retain a snapshot of its database for recovering any records written after cutover. Restore the verified pre-upgrade snapshot into a separate directory with owner-only access, then point the previous application version at it. Keep each database and its WAL and SHM files in the same generation. Verify readiness and an allowed call before routing clients back.

## Interactive routes and sandboxing

Shared connections omit elicitation and sampling. To enable interactive calls
for a trusted pair, set `MCP_GATEWAY_INTERACTIVE_ROUTES=endpoint-slug:backend-key`.
Each call opens a separate upstream connection, which also means the backend
must support starting a clean session for that call. The gateway forwards form
elicitation and bounded sampling. Use a client that prompts for consent.

To run selected stdio connectors through an operator-controlled sandbox, set
`MCP_GATEWAY_SANDBOX_BACKENDS` to their keys and set
`MCP_GATEWAY_STDIO_LAUNCHER` to the absolute path to the launcher. Sandboxed
connector commands must also use absolute paths. The [Bubblewrap example](stdio-bwrap.sh)
runs on Linux hosts with user namespaces enabled. Adapt its read-only mounts to
your connector directories and test the wrapper directly before granting access.

## OAuth endpoints

Configure an external issuer that produces RFC 9068 access tokens for the exact
endpoint resource URL, for example `https://mcp.gateway.example/api/mcp/oauth-endpoint`.
Create the endpoint in the dashboard, then list its slug in
`MCP_GATEWAY_OAUTH_ENDPOINTS`. Set the issuer, JWKS URL and public resource origin
from the sample environment file. The issuer must grant scope
`mcp:oauth-endpoint` and issue an RS256 or ES256 token with a lifetime of up to
15 minutes. Configure the issuer's client registration and redirect handling
according to its own docs.

Static bearer credentials are rejected for OAuth-only endpoints. Tokens bind
to their own MCP sessions, so a refreshed credential starts a new session.
Configure token introspection when you need issuer revocation to take effect
on the next HTTP request. Sessions with an open stream also expire when the
credential expires. The proxy must expose the matching protected-resource
metadata path on the MCP hostname.

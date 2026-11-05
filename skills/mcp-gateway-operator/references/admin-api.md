# Admin API reference

This reference describes the MCP Gateway 0.4.x contract. Use the actual trusted
dashboard origin for every relative route below.

## Authentication

Automation sends the dedicated admin token as a Bearer credential.
Browser sign-in uses `POST /api/admin/session` with JSON
`{"password":"<admin-token>"}` and a trusted `Origin`. It returns an HttpOnly
session cookie. Sign-out uses `DELETE /api/admin/session` with the cookie and
trusted Origin. Browser sessions expire after 12 hours or a gateway restart.

Cookie-authenticated mutations require the trusted Origin. Host and Origin
validation also applies to Bearer-authenticated requests. Use the endpoint's own
credential for MCP requests to `/api/mcp/<slug>`.

## Common routes

| Purpose | Request |
| --- | --- |
| Read enabled-backend readiness | `GET /api/settings/health` |
| Read backend inventory | `GET /api/servers` |
| Create a backend | `POST /api/servers` |
| Read, update, or remove one backend | `GET`, `PATCH`, or `DELETE /api/servers/<id>` |
| Reconnect one backend | `POST /api/servers/<id>/reconnect` |
| Read or change global tool switches | `GET` or `PUT /api/servers/<id>/tools` |
| Read or create client endpoints | `GET` or `POST /api/endpoints` |
| Read or update an endpoint | `GET` or `PATCH /api/endpoints/<id>` |
| Read or change server access | `GET` or `PUT /api/endpoints/<id>/rules` |
| Inspect effective tool access | `GET /api/endpoints/<id>/tool-policy?backendServerId=<backend-id>` |
| Change a tool rule or policy mode | `PUT /api/endpoints/<id>/tool-policy` |
| Browse audit history | `GET /api/audit` |
| Export backend configuration | `GET /api/settings/config` |
| Preview backend configuration | `POST /api/settings/config` |
| Apply backend configuration | `POST /api/settings/config?apply=1` |

## Backend creation and updates

A stdio backend requires `name`, `key`, `connectionType: "stdio"`, and
`command`. Optional fields include `args`, `env`, `description`, and
`enabled`.

An HTTP or SSE backend uses `connectionType: "http"` or `"sse"` and `url`,
with optional `headers`. Keys contain letters, numbers, and hyphens.
Keep the built-in `gateway-tools` backend managed by the gateway.

For updates, send only the fields being changed using `PATCH`. Read responses
mask values in `env` and `headers` as empty strings.

To replace a header while preserving a stored Authorization value, an update can
use this shape with the real new value supplied through an appropriate secret
source.

```json
{
  "headers": {
    "Authorization": null,
    "X-Workspace": "example-workspace"
  }
}
```

Every other header key omitted from this edited object is removed. Omitting
`headers` entirely preserves the whole stored object. The same rules apply to
`env`.

Values may reference service environment variables such as
`${env:MCP_BACKEND_SECRET_EXAMPLE}`. Only the `MCP_BACKEND_SECRET_` prefix
is supported. The referenced variable must exist in the running service.
Private or plain HTTP backend origins require exact entries in
`MCP_GATEWAY_PRIVATE_BACKEND_ORIGINS`.

## Access policies

Endpoint creation accepts `name`, `slug`, `enabled`, and `defaultPolicy`
of `"deny_all"` or `"allow_all"`. Its generated token is returned once.
Store it through the intended credential channel without copying it into a task
or source file.

A server access rule uses
`{"backendServerId":"<id>","access":"allow"}`. Valid access values are
`allow`, `deny`, and `inherit`.

A global tool switch uses
`{"toolName":"original_tool_name","enabled":false}`. Tool-policy writes use
the original backend tool name as well, without the gateway namespace.

A per-endpoint tool rule uses
`{"backendServerId":"<id>","toolName":"original_tool_name","access":"allow"}`.
An explicit allow may establish allowlist mode. A separate mode write uses
`{"backendServerId":"<id>","mode":"allowlist"}` or `"inherit"`.

Read the effective policy after updating it. A global disabled tool or denied
backend cannot be granted by an endpoint tool rule.

## Config preview and audit

A version 1 config has the shape
`{"version":1,"backends":[...]}`, with backend entries using the creation
fields above. Preview returns proposed creates and updates. Apply matches
existing backends by key and reconnects the changed rows. Backends absent from
the payload are retained. The built-in keys are reserved.

Exports retain supported environment-variable references and omit literal
header and environment secrets. The export does not include endpoint tokens,
access rules, client history, or audit history.

Audit queries support `endpointId`, `backendServerId`, `clientId`,
`status`, `operationType`, `search`, `itemName`, `from`, and `to`.
For recent tool calls, use `operationType=tools%2Fcall`. Use `nextCursor`
as the next request's `before` value for older rows.

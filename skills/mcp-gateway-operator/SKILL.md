---
name: mcp-gateway-operator
description: Inspect and manage MCP Gateway backends, endpoint access rules, and deployment diagnostics through an authorized dashboard or admin API connection. Use for operator configuration and troubleshooting requests.
license: MIT
---

# MCP Gateway Operator

Manage the gateway installation identified by the user. Confirm the target
instance and the requested change from the available configuration before
writing. Preserve the user's existing endpoints, client IDs, backend settings,
and credentials.

## Establish operator access

Use an existing authorized admin connection. The dashboard accepts the configured
admin token on its sign-in page. Admin scripts use
`Authorization: Bearer <admin-token>` over the trusted dashboard origin.
Endpoint MCP tokens confer no admin authority.

Keep credentials in the client's credential store or the operator's secret
source. Pass them to requests without printing them. Use the configured trusted
origin and private-backend allowlist when resolving connection issues.

Read [references/admin-api.md](references/admin-api.md) for the 0.4.x admin API
routes, payloads, secret-preservation rules, and configuration preview behavior.
Inspect the installed gateway's version when its behavior differs.

## Inspect before changing

Check the enabled backends and their status, the target endpoint's default policy,
and relevant server and tool rules. Public `/api/health` is a liveness check.
The authenticated `/api/settings/health` reports readiness of enabled backends.
An unreachable backend can make readiness fail while the gateway is running.

Do not round-trip a masked backend response into a write. Omit untouched `env`
or `headers` fields. If editing one of those objects, include each retained key
with `null` and provide literal strings only for values being changed. Omitted
keys in an edited object are removed; an empty string writes an empty value.

## Apply the requested change

Use the smallest operation that satisfies the user's request. Check for an
existing backend or endpoint before creating one.

- Adding or editing a stdio backend changes executable commands run under the
  gateway service account. Review the command, arguments, and environment as
  part of the requested configuration.
- For missing tools, distinguish backend connectivity, a global tool switch,
  endpoint-to-server access, and endpoint-specific tool policy. Apply a targeted
  rule rather than widening the endpoint's default policy.
- Granting the first explicit tool allow can put that endpoint/backend pair into
  allowlist mode. Read back the effective rules and mode after editing them.
- Reconnecting a backend can interrupt in-flight work. Reconnect the affected
  server when the diagnosis and the user's request justify it.
- Credential rotation invalidates existing access. Account for the affected
  clients before performing a requested rotation.

For a bulk configuration import, preview its proposed changes first. Apply the
reviewed payload only within the authorized scope. An exported backend config
omits literal secrets and client endpoint state; it is not a database backup.

## Verify the outcome

Read back the changed fields and effective policy. Verify readiness and, when
appropriate, a harmless call through the affected MCP endpoint. State any
backend or client that could not be checked.

The topology gives quick calls at least one visible particle pass. Use the audit
entry's duration and outcome to judge the real tool call.

For deployment work, retain a consistent database backup and the current runtime
and service configuration before cutover. Test existing client credentials and
enabled backends against the candidate, and use the rollback condition agreed
for that deployment. Follow the installation's deployment procedure.

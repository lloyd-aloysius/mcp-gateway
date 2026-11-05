# Security Policy

## Threat model (read this first)

MCP Gateway is a personal, single-operator service. A loopback-bound installation
can use local administration. Remote administration requires a separate
administrator credential and a trusted origin. Endpoint bearer tokens grant
access to MCP capabilities according to endpoint policy. The administrator can
configure executable backend programs, so run the service under a dedicated
account and grant access only to trusted operators.

Use HTTPS and separate the admin and MCP ingress. Configure private backend
destinations explicitly and keep service storage and backups private. See the
[deployment guide](docs/deployment/README.md).

## Supported versions

Apply security fixes using the latest stable npm version or a newer reviewed
source revision. Release notes identify compatibility and migration requirements.

## Reporting a vulnerability

If you find a genuine security issue (e.g. a way to bypass endpoint token
auth, an injection vector, a secret-leakage path through a tool result),
please **do not open a public issue**. Instead:

- Use GitHub's [private vulnerability reporting](../../security/advisories/new)
  for this repo, or
- Email the maintainer directly (see the GitHub profile for contact info).

Please include steps to reproduce and the potential impact. There's no formal
SLA (single-maintainer project), but reports will be triaged as soon as
possible and credited in the fix, unless you'd prefer otherwise.

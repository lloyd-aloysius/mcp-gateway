# Security Policy

## Threat model (read this first)

MCP Gateway is designed for **personal, single-user, self-hosted use**. By
design:

- There is **no login/authentication on the dashboard itself**. Anyone who can
  reach the dashboard's URL can manage backend servers, endpoints, and tokens.
- Client *endpoints* (the URLs you hand out to MCP clients) are protected by a
  bearer token, hashed with SHA-256 at rest.
- The safety boundary is meant to be the network, not the app: bind to
  `127.0.0.1` (the default) and use your own firewall/VPN/SSH tunnel/Tailscale
  for remote access. The Settings page warns if it detects non-localhost
  access.

**"The dashboard has no login" is a known, intentional design trade-off, not a
vulnerability** — please don't open a report for it. See the README's
[Security notes](README.md#security-notes) section for the full rationale.

## Supported versions

This project doesn't yet follow a formal versioning/release process — only
the `main` branch is supported. Please make sure you're on the latest commit
before reporting an issue.

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

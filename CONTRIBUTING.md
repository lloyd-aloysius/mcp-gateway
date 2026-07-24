# Contributing to MCP Gateway

Thanks for considering a contribution. This is a single-maintainer, self-hosted
project, so the process is kept intentionally lightweight.

## Getting set up

```bash
git clone <your fork>
cd mcp-gateway
npm install
npm run dev
```

The SQLite database is created automatically on first run at `./data/gateway.db`
(gitignored). No seed data or extra setup is required to get the dashboard
running at [http://localhost:3000](http://localhost:3000).

Note: `npm install` now also runs a one-time production build via the `prepare`
script (see below) — that's expected, not a hang. It doesn't affect `npm run dev`.

## How the CLI packaging works

`npm run build` does two things: `next build` (with `output: "standalone"` in
`next.config.ts`), then `scripts/copy-standalone-assets.mjs`, which copies in
everything Next's own file-tracing doesn't know about because it's only ever
referenced by a runtime path string, not a JS import: `public/`, `.next/static`
(both documented by Next itself), the Drizzle `drizzle/` migrations folder,
`scripts/` (the built-in `gateway-tools-server.mjs`, spawned as its own child
process — needs its own copy of `node_modules/@modelcontextprotocol` too,
since it's never bundled by webpack like the rest of the server), and —
confirmed empirically, not documented anywhere — `instrumentation.js` and its
Turbopack runtime chunk, which standalone tracing silently drops even though
`next-server.js` looks for it at boot. Skipping any of these means migrations
silently never run and the app boots against an empty database with no error.

`bin/cli.mjs` (what `npx mcp-gateway` / `npx github:<owner>/mcp-gateway` runs,
and what `npm start` / `scripts/start.mjs` delegates to for a git-clone
deploy) then runs `.next/standalone/server.js` directly instead of
`next start` (which prints a warning and ignores standalone output entirely).
It resolves `DATABASE_PATH` from the *caller's* working directory before
handing the server a different `cwd` (the standalone folder, where its own
trimmed `node_modules`/`drizzle`/`scripts` live) — so the SQLite file always
ends up next to wherever you actually ran the command, not inside the
installed package.

If you change any of this, verify with a real out-of-tree run, not just
`npm run dev`:

```bash
npm run build
mkdir -p /tmp/mcpgw-test && cd /tmp/mcpgw-test
PORT=3900 node /path/to/mcp-gateway/bin/cli.mjs
# then confirm ./data/gateway.db was created *here*, migrations ran
# (sqlite3 data/gateway.db ".tables"), and the built-in gateway-tools
# server shows "connected" via curl localhost:3900/api/servers
```

## Making changes

- **Database schema**: edit `src/server/db/schema.ts`, then run `npm run db:generate`
  to produce a Drizzle migration under `drizzle/`. Migrations run automatically
  at boot (`instrumentation.ts`) — don't hand-edit the SQLite file.
- **UI**: this uses Tailwind CSS v4 + shadcn/ui (base-ui primitives). Prefer
  reusing existing components in `src/components/ui/` over adding new
  dependencies. If a shared primitive (e.g. `src/components/ui/table.tsx`)
  needs a behavior change, check every page that uses it first — a few past
  fixes here were deliberately scoped to a single page's cell className rather
  than the shared primitive, to avoid unintended layout shifts elsewhere.
- **Gateway/dispatch logic**: `src/server/gateway/` is the core — access
  control (`access-control.ts`) is evaluated per-server, fresh on every call,
  not cached into a session's tool list. If you're changing dispatch behavior,
  make sure denied calls still get audited (`status: "denied"`), not silently
  dropped.

## Before opening a PR

Run the same checks CI runs:

```bash
npx tsc --noEmit
npm run lint
npm run build
```

All three should be clean. If you're touching UI, actually click through the
affected page(s) in a browser — type-checking and linting verify code
correctness, not feature correctness.

## Commit messages / PRs

- Keep commits focused; a bug fix doesn't need to bundle unrelated cleanup.
- Write commit messages and PR descriptions around the *why*, not just the
  *what* — the diff already shows what changed.
- Reference the issue you're fixing, if there is one.

## Releases & versioning

This project follows [semantic versioning](https://semver.org/). Releases are
cut by the maintainer, not by individual PRs — when a version tag (e.g.
`v1.2.0`) is pushed, CI automatically runs the full check suite, publishes
the package to npm, and creates the matching GitHub Release with
auto-generated notes. As a contributor you don't need to bump versions or
publish anything yourself; just focus on the PR and it'll ship in the next
release.

## Reporting bugs / requesting features

Use the GitHub issue templates. For anything security-related, see
[SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

By contributing, you agree that your contributions will be licensed under the
project's [MIT License](LICENSE).

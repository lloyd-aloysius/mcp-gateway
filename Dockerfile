# Multi-stage build - the final image only carries the already-built,
# already-trimmed standalone output (see scripts/copy-standalone-assets.mjs),
# never the full source tree or devDependencies.
#
# Both stages use Alpine (musl libc) rather than a glibc-based image
# deliberately: better-sqlite3 ships separate native prebuilds per platform,
# and its glibc-linked arm64 build requires a newer glibc (>=2.38) than its
# x64 build does (>=2.34) - a mismatch baked into the upstream package, not
# this project. That gap doesn't exist on musl at all, so an Alpine-based
# image works identically on x64 and arm64 hosts regardless of what glibc
# version the *host* happens to have - the container carries its own libc.
FROM node:22-alpine AS builder
# better-sqlite3 has a binding.gyp and no explicit install script, so plain
# `npm ci` implicitly tries to compile it via node-gyp even though a prebuild
# already exists for this platform - Alpine's base image has no Python/C++
# toolchain, so that implicit compile fails outright without these.
RUN apk add --no-cache python3 make g++
WORKDIR /app
# package.json declares "prepare": "npm run build", which npm runs
# automatically as part of `npm ci` - so the full source needs to already be
# present before that step, not copied in afterward (the usual
# copy-package.json-then-npm-ci-then-copy-source layering doesn't work here,
# since `npm ci` alone would try to build with no app/ directory yet copied).
COPY . .
# Drop `prepare` before installing, so `npm ci` only installs dependencies
# (still running every other package's own legitimate install scripts, e.g.
# esbuild's postinstall) without auto-triggering our build yet.
RUN npm pkg delete scripts.prepare
RUN npm ci
# `next build` collects page data by importing every route module in
# several parallel worker *processes*. src/server/db/client.ts eagerly opens
# the SQLite file at import time, and its process-local connection-reuse
# guard is disabled under NODE_ENV=production (which `next build` sets) - so
# every worker independently races to create-and-WAL-init the same brand-new
# file at once, which is exactly the scenario SQLite's locking handles
# worst. Hit as a real `SQLITE_BUSY: database is locked` build failure.
# Pre-creating the file single-process first means the workers are just
# doing ordinary concurrent *opens* of an already-initialized file.
RUN mkdir -p data && node -e "const db = require('better-sqlite3')('data/gateway.db'); db.pragma('journal_mode = WAL'); db.close();"
RUN npm run build

FROM node:22-alpine AS runtime
# better-sqlite3's native binding dynamically links libstdc++, which Alpine's
# base image doesn't include by default.
RUN apk add --no-cache libstdc++
WORKDIR /app
COPY --from=builder /app/.next/standalone ./

ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV DATABASE_PATH=/data/gateway.db

# The SQLite file belongs in a mounted volume, not the image itself, so data
# survives image rebuilds/updates.
VOLUME /data
EXPOSE 3000

CMD ["node", "server.js"]

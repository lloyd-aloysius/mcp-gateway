# Vendored better-sqlite3 prebuilds

`linux-arm64.node` here replaces the one better-sqlite3 ships in its own npm
package. Upstream's arm64 Linux prebuild is linked against glibc >= 2.38,
while their x64 Linux prebuild only needs glibc >= 2.34 - a mismatch between
the two platform builds, not something version-specific to a particular
better-sqlite3 release. That gap excludes arm64 hosts on Debian 12, Ubuntu
22.04, RHEL 9, and Amazon Linux 2023 (all glibc < 2.38) even though the
identical x64 host on the same distro works fine.

This file is a straight `node-gyp rebuild` of the same better-sqlite3 source
(no code changes), compiled on Debian 11 "bullseye" (glibc 2.31) instead of
whatever newer image upstream used, so it's linked against older glibc
symbol versions. Verified (see the project's build history) to need only
glibc >= 2.29 - lower than even the x64 build's floor - and functionally
tested with real read/write/pragma operations on a glibc 2.36 (Debian 12)
arm64 container.

`scripts/copy-standalone-assets.mjs` copies this file over the one from
`node_modules/better-sqlite3/prebuilds/linux-arm64.node` after copying the
rest of the prebuilds directory as-is. Only `linux-arm64.node` is overridden
- x64 already has the wider floor, and the musl builds (`linuxmusl-*.node`)
carry no glibc version symbols at all, so neither needed a rebuild.

## Regenerating (e.g. after a better-sqlite3 version bump)

```bash
# 1. Copy the package's own source (not its prebuilds/build output) into a
#    scratch dir, matching whatever version is currently in package.json:
cp -r node_modules/better-sqlite3 /tmp/bsqlite3-src
rm -rf /tmp/bsqlite3-src/build /tmp/bsqlite3-src/prebuilds

# 2. Build it inside a Debian bullseye arm64 container (Docker on an Apple
#    Silicon Mac runs this natively; on x64 hosts this runs under emulation
#    and will be much slower):
docker run --rm --platform linux/arm64 -v /tmp/bsqlite3-src:/src debian:bullseye bash -c '
  apt-get update -qq && apt-get install -y -qq python3 make g++ curl xz-utils
  curl -fsSL https://nodejs.org/dist/v22.14.0/node-v22.14.0-linux-arm64.tar.xz -o /tmp/node.tar.xz
  mkdir -p /usr/local/lib/nodejs && tar -xJf /tmp/node.tar.xz -C /usr/local/lib/nodejs
  export PATH="/usr/local/lib/nodejs/node-v22.14.0-linux-arm64/bin:$PATH"
  npm install -g node-gyp@10
  cd /src && npm install --omit=dev --no-save
  node-gyp rebuild --release --target=22.14.0 --arch=arm64
'

# 3. Verify the glibc floor actually dropped (expect no symbol above 2.3x,
#    well under upstream's 2.38):
strings -a /tmp/bsqlite3-src/build/Release/better_sqlite3.node | grep -oE "GLIBC_[0-9]+\.[0-9]+" | sort -V -u

# 4. Functionally test it on a realistic glibc floor before trusting it -
#    symbol versions alone don't prove the binary actually works:
docker run --rm --platform linux/arm64 -v /tmp/bsqlite3-src:/src node:22-bookworm-slim node -e "
  const Database = require('/src');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY)');
  db.prepare('INSERT INTO t DEFAULT VALUES').run();
  console.log(db.prepare('SELECT * FROM t').get());
"

# 5. Copy the result here:
cp /tmp/bsqlite3-src/build/Release/better_sqlite3.node vendor/better-sqlite3-prebuilds/linux-arm64.node
```

#!/bin/sh
# Install as an executable, operator-owned file and adapt the read-only
# connector directory for the host. Bubblewrap requires Linux user namespaces.
set -eu

exec /usr/bin/bwrap \
  --unshare-all --die-with-parent --new-session \
  --ro-bind /usr /usr --ro-bind-try /bin /bin --ro-bind-try /lib /lib --ro-bind-try /lib64 /lib64 \
  --proc /proc --dev /dev --tmpfs /tmp \
  --ro-bind /opt/mcp-connectors /opt/mcp-connectors \
  --dir /home/connector --setenv HOME /home/connector \
  --chdir /opt/mcp-connectors -- "$@"

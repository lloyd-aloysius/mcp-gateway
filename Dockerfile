FROM node:22-alpine AS base
RUN apk add --no-cache libstdc++
WORKDIR /app

FROM base AS builder
COPY . .
# The package includes SQLite's musl prebuild. Keep build-only dependencies
# and the npm cache out of image layers, and run one explicit build.
RUN --mount=type=tmpfs,target=/app/node_modules \
    --mount=type=tmpfs,target=/root/.npm \
    npm ci --ignore-scripts --no-audit --no-fund && npm run build

FROM base AS runtime
COPY --from=builder --chown=node:node /app/.next/standalone ./
RUN install -d -m 0700 -o node -g node /data

ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV DATABASE_PATH=/data/gateway.db
ENV NEXT_MANUAL_SIG_HANDLE=1
VOLUME /data
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD node -e 'fetch("http://127.0.0.1:" + process.env.PORT + "/api/health").then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'
CMD ["node", "server.js"]

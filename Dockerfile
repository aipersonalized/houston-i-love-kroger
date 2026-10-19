# syntax=docker/dockerfile:1
# check=error=true

# Record the resolved image digest for a release; NODE_IMAGE may also name a digest.
ARG NODE_IMAGE=node:22.23.2-bookworm-slim
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=dev --no-audit --no-fund \
    && node --input-type=module -e "import Database from 'better-sqlite3'; const db = new Database(':memory:'); if (db.prepare('SELECT 1 AS value').get().value !== 1) process.exit(1); db.close();" \
    && npm cache clean --force

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173 \
    APP_BASE_PATH=/apps/houston-i-love-kroger/ \
    HISTORY_DB_PATH=/data/history.sqlite
WORKDIR /app
RUN mkdir -p /data && chown node:node /data
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json LICENSE THIRD_PARTY_NOTICES.md ./
COPY src/ ./src/
COPY public/ ./public/
COPY migrations/ ./migrations/
USER node
EXPOSE 4173
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "--input-type=module", "-e", "const u = 'http://127.0.0.1:' + process.env.PORT + process.env.APP_BASE_PATH + 'api/v1/status'; const r = await fetch(u, {signal: AbortSignal.timeout(4000)}); const b = await r.json(); if (!r.ok || b.ok !== true || b.apiVersion !== 1) process.exit(1);"]
CMD ["node", "src/server.js"]

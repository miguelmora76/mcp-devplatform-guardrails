FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production \
    GUARDRAILS_AUDIT_PATH=/data/audit.jsonl \
    GUARDRAILS_SOCKET_DIR=/tmp/guardrails-run
RUN mkdir -p /data && chown node:node /data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY snapshots ./snapshots
USER node
EXPOSE 8787
# The HTTP transport binds to loopback inside the pod by design: reach it with `kubectl port-forward`.
CMD ["node", "dist/bin/server.js", "--http"]

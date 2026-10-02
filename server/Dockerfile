# ---- Build ----
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace=shared --workspace=server --include-workspace-root=false
COPY shared/ shared/
COPY server/ server/
RUN npm run build --workspace=shared && npm run build --workspace=server

# ---- Runtime ----
FROM node:24-alpine
RUN apk add --no-cache tini
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --workspace=shared --workspace=server --include-workspace-root=false && npm cache clean --force
COPY --from=builder /app/shared/dist shared/dist
COPY --from=builder /app/server/dist server/dist

# /data holds uploaded files (local storage), resumable-upload chunks,
# thumbnails and branding assets — mount a persistent volume here.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
ENV NODE_ENV=production PORT=3001 DATA_DIR=/data
USER node
WORKDIR /app/server
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3001/health >/dev/null || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/src/index.js"]

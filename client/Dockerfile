# ---- Build ----
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --workspace=client --include-workspace-root=false
COPY shared/ shared/
COPY client/ client/
RUN npm run build --workspace=client

# ---- Runtime ----
FROM nginx:1.27-alpine
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY client/ferry-proxy.inc /etc/nginx/conf.d/ferry-proxy.inc
COPY --from=builder /app/client/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1

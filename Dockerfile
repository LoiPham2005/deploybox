# DeployBox "trong 1 hộp" — API + Web + Caddy + toolchain để deploy app user.
# Build: docker compose build   |   Chạy: docker compose up -d

# ========== Stage 1: build (shared + api + web) ==========
FROM node:24-bookworm AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@latest --activate
# Cache deps: copy manifest trước
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile
# Copy source + build
COPY . .
RUN pnpm build

# ========== Stage 2: runtime ==========
FROM node:24-bookworm AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Toolchain: git (clone repo user), caddy (reverse proxy), docker-cli (deploy app Docker-mode)
RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https \
 # --- Caddy (multi-arch repo) ---
 && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg \
 && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list \
 # --- Docker CLI (arch-aware) ---
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
 && chmod a+r /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends caddy docker-ce-cli \
 && rm -rf /var/lib/apt/lists/*

# pnpm (build app user host-run) + pm2 (chạy api+web trong container)
RUN corepack enable && corepack prepare pnpm@latest --activate && npm install -g pm2

# Copy toàn bộ app đã build từ stage builder
COPY --from=builder /app ./
COPY ecosystem.docker.config.js ./ecosystem.docker.config.js

EXPOSE 3000 4000 8080
# pm2-runtime giữ container sống + quản lý api & web; API tự spawn Caddy + app host-run
CMD ["pm2-runtime", "start", "ecosystem.docker.config.js"]

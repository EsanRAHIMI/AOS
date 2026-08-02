# Autonomous OS Kernel — Dokploy / production image
#
# Prefer Dockerfile over Nixpacks: Nixpacks cold builds spend ~8+ minutes
# unpacking nixpkgs before pnpm even starts. Official Node images cache well.
#
# Dokploy Application settings (همهٔ سرویس‌ها):
#   Build Type:       Dockerfile
#   Docker File:      Dockerfile
#   Root Directory:   /   (روت monorepo — الزامی)
#   Docker Build Stage: runtime   (اگر Dokploy stage می‌پرسد)
#
# مهم: Envهای Dokploy معمولاً فقط در runtime تزریق می‌شوند، نه build.
# برای سرویس‌های غیر dashboard حتماً Build Arg بگذار:
#   Advanced → Build Args → SERVICE_ID=<id>
# اگر Build Arg خالی باشد، build عمداً و فوراً متوقف می‌شود.
#
# Local smoke:
#   docker build --build-arg SERVICE_ID=dashboard-web -t aos-dashboard .
#   docker run --rm -e SERVICE_ID=dashboard-web -e SERVICE_PORT=4100 -p 4100:4100 aos-dashboard

FROM node:22-bookworm-slim AS build
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@9.15.0 --activate

COPY . .

ARG SERVICE_ID
ENV SERVICE_ID=${SERVICE_ID}
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV NPM_CONFIG_PRODUCTION=false
# Headroom for Next.js / tsc on small Dokploy build hosts
ENV NODE_OPTIONS=--max-old-space-size=4096

RUN echo "docker-build: SERVICE_ID=${SERVICE_ID}" \
  && test -n "$SERVICE_ID" || (echo "ERROR: SERVICE_ID is empty" && exit 1)
RUN --mount=type=cache,id=pnpm-generic,target=/pnpm/store \
  pnpm config set store-dir /pnpm/store \
  && pnpm config set network-concurrency 4 \
  && pnpm config set fetch-retries 5 \
  && pnpm install --filter "@factory/${SERVICE_ID}..." --frozen-lockfile
RUN chmod +x scripts/nixpacks-build.sh scripts/nixpacks-start.sh \
  && bash scripts/nixpacks-build.sh

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@9.15.0 --activate \
  && groupadd --system --gid 1001 aos \
  && useradd --system --uid 1001 --gid aos --create-home aos

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0

COPY --from=build --chown=aos:aos /app /app

USER aos

# Re-declare so runtime image keeps the build-arg value.
ARG SERVICE_ID
ENV SERVICE_ID=${SERVICE_ID}

EXPOSE 4100
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bash", "scripts/nixpacks-start.sh"]

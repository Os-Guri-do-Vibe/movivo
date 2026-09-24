# syntax=docker/dockerfile:1.7
# =============================================================================
# MOVIVO — imagem de produção do frontend (Next.js standalone)
# =============================================================================
# Dono: Henrique (Platform/SRE)
#
# Build a partir da RAIZ do monorepo:
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_SITE_URL=https://movivo.com.br \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.movivo.com.br/api/v1 \
#     -t movivo-web .
#
# ⚠️ Tudo que é NEXT_PUBLIC_* é gravado no bundle NO BUILD (não no runtime):
# trocar de ambiente = gerar outra imagem. Por isso esses valores são build args,
# e nenhum deles pode ser segredo (ver apps/web/.env.example).
#
# Runtime lê só envs de servidor, ex.: MOVIVO_API_URL=http://api:3001/api/v1
# (BFF do dashboard falando com a API pela rede interna do Compose).
# =============================================================================

ARG NODE_VERSION=22.22.0
ARG PNPM_VERSION=11.15.1

FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    NEXT_TELEMETRY_DISABLED=1
RUN npm install -g "pnpm@${PNPM_VERSION}" && npm cache clean --force
WORKDIR /app

# -----------------------------------------------------------------------------
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@movivo/web..."

COPY packages/shared packages/shared
COPY apps/web apps/web

ARG NEXT_PUBLIC_APP_ENV=production
ARG NEXT_PUBLIC_SITE_URL=https://movivo.com.br
ARG NEXT_PUBLIC_API_URL=https://api.movivo.com.br/api/v1
ARG NEXT_PUBLIC_POSTHOG_KEY=
ARG NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
ENV NODE_ENV=production \
    NEXT_OUTPUT_STANDALONE=1 \
    NEXT_PUBLIC_APP_ENV=${NEXT_PUBLIC_APP_ENV} \
    NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL} \
    NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_POSTHOG_KEY=${NEXT_PUBLIC_POSTHOG_KEY} \
    NEXT_PUBLIC_POSTHOG_HOST=${NEXT_PUBLIC_POSTHOG_HOST}

RUN pnpm --filter @movivo/shared run build \
 && pnpm --filter @movivo/web run build

# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    TZ=America/Sao_Paulo \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# O standalone espelha o monorepo (outputFileTracingRoot = raiz): o servidor fica
# em apps/web/server.js. Estáticos e public/ não entram no trace — copiados à parte.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public

USER node
EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/icon.svg').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/web/server.js"]

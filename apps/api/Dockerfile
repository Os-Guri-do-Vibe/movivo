# syntax=docker/dockerfile:1.7
# =============================================================================
# MOVIVO — imagem de produção da API (NestJS)
# =============================================================================
# Dono: Henrique (Platform/SRE)
#
# Build a partir da RAIZ do monorepo (o workspace pnpm precisa do lockfile e do
# packages/shared):
#   docker build -f apps/api/Dockerfile -t movivo-api .
#
# Estágios:
#   base   → Node + pnpm fixados na mesma versão do package.json raiz
#   build  → instala tudo (dev incluso), compila packages/shared e apps/api
#   prod   → reinstala SÓ dependências de produção (sem tsx, drizzle-kit, vitest)
#   runtime→ copia node_modules de prod + dist/assets/drizzle; roda como `node`
#
# A mesma imagem roda a API e a migração:
#   node --enable-source-maps dist/main.js                 (padrão)
#   node --enable-source-maps dist/core/database/migrate.js (job one-shot)
# Ambos usam o cwd /app/apps/api — o migrate lê ./drizzle e o PDF lê ./assets.
# =============================================================================

ARG NODE_VERSION=22.22.0
ARG PNPM_VERSION=11.15.1

FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
RUN npm install -g "pnpm@${PNPM_VERSION}" && npm cache clean --force
WORKDIR /app

# -----------------------------------------------------------------------------
FROM base AS build
# Manifestos primeiro: a camada de install só invalida quando dependência muda.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@movivo/api..."

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @movivo/shared run build \
 && pnpm --filter @movivo/api run build

# -----------------------------------------------------------------------------
FROM base AS prod
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter "@movivo/api..."

# -----------------------------------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    TZ=America/Sao_Paulo
# tini como PID 1: repassa SIGTERM ao Node (graceful shutdown do Nest drena
# conexões e deixa os workers BullMQ terminarem o job em voo) e recolhe zumbis.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Symlinks do pnpm são relativos — o layout /app/{node_modules,packages,apps}
# precisa ser idêntico ao do estágio `prod`.
COPY --from=prod --chown=node:node /app/node_modules ./node_modules
COPY --from=prod --chown=node:node /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=build --chown=node:node /app/packages/shared/package.json ./packages/shared/
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=prod --chown=node:node /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=node:node /app/apps/api/package.json ./apps/api/
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/apps/api/drizzle ./apps/api/drizzle
COPY --from=build --chown=node:node /app/apps/api/assets ./apps/api/assets

WORKDIR /app/apps/api
# Diretório de upload de avatar (AVATAR_UPLOAD_DIR=./uploads/avatars) — em produção
# é sobrescrito por um bind mount de /opt/movivo/uploads.
RUN mkdir -p uploads/avatars && chown -R node:node uploads

USER node
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/'+(process.env.API_GLOBAL_PREFIX||'api/v1')+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/main.js"]

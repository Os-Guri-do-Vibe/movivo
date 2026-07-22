# =============================================================================
# MOVIVO — Atalhos operacionais do ambiente local
# =============================================================================
# Dono: Henrique Matsuda (Platform/SRE) · US-0.2 / TASK-0.2.4
#
# `make` não vem instalado por padrão no Windows, e dois dos três devs do time
# trabalham nele. Por isso TODO alvo aqui tem um equivalente 1:1 em
# `pnpm run infra:<alvo>` (package.json da raiz), que é o caminho oficial
# multiplataforma. Este Makefile existe para quem já tem make (Linux/macOS/WSL)
# e para o CI, onde `make` é o idioma comum.
#
# Regra: a lógica mora no docker-compose.yml; aqui só há atalhos. Se um alvo
# precisar de lógica própria, ela vira script versionado em scripts/.
# =============================================================================

COMPOSE ?= docker compose
SHELL   := /bin/sh

.DEFAULT_GOAL := help
.PHONY: help secrets up down stop restart logs ps health psql psql-admin \
        pools redis-cli sentinel verify reset nuke config

## help: lista os alvos disponíveis
help:
	@echo "MOVIVO — ambiente local (US-0.2). Alvos disponíveis:"
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## /  make /'

## secrets: gera os Docker Secrets locais (idempotente; NÃO rotaciona)
secrets:
	@bash scripts/gen-local-secrets.sh

## up: sobe o stack e BLOQUEIA até todos os serviços ficarem healthy
up:
	$(COMPOSE) up -d --wait --wait-timeout 300
	@$(MAKE) --no-print-directory ps

## down: derruba os containers e a rede (VOLUMES PRESERVADOS — os dados ficam)
down:
	$(COMPOSE) down --remove-orphans

## stop: para os containers sem removê-los (retomar com `make up`)
stop:
	$(COMPOSE) stop

## restart: reinicia os serviços preservando dados
restart: stop up

## ps: estado e health de cada serviço
ps:
	$(COMPOSE) ps

## logs: segue os logs de todos os serviços (SVC=postgres para filtrar um)
logs:
	$(COMPOSE) logs -f --tail=100 $(SVC)

## config: imprime o compose resolvido (útil para auditar que não há secret nele)
config:
	$(COMPOSE) config

## health: uma linha por serviço com o status do healthcheck
health:
	@$(COMPOSE) ps --format '{{.Name}}\t{{.Status}}'

## psql: shell psql como movivo_app, VIA PGBOUNCER (5433) — o caminho da app
psql:
	@$(COMPOSE) exec -e PGPASSWORD="$$(cat secrets/postgres_app_password)" \
		pgbouncer psql -h 127.0.0.1 -p 5433 -U movivo_app -d movivo

## psql-admin: shell psql como movivo_migrator, DIRETO na 5432 (só migração/DDL)
psql-admin:
	@$(COMPOSE) exec -e PGPASSWORD="$$(cat secrets/postgres_migrator_password)" \
		postgres psql -h 127.0.0.1 -p 5432 -U movivo_migrator -d movivo

## pools: SHOW POOLS no console admin do PgBouncer (confirma transaction mode)
pools:
	@$(COMPOSE) exec -e PGPASSWORD="$$(cat secrets/postgres_migrator_password)" \
		pgbouncer psql -h 127.0.0.1 -p 5433 -U movivo_migrator -d pgbouncer -c 'SHOW POOLS;'

## redis-cli: shell redis-cli autenticado no master
redis-cli:
	@$(COMPOSE) exec redis-master sh -c \
		'redis-cli --no-auth-warning -a "$$(cat /run/secrets/redis_password)"'

## sentinel: estado do master conforme o Sentinel
sentinel:
	@$(COMPOSE) exec redis-sentinel sh -c \
		'redis-cli --no-auth-warning -a "$$(cat /run/secrets/redis_password)" -p 26379 sentinel master movivo-master'

## verify: roda o checklist de segurança/sanidade do ambiente (US-0.2 DoD)
verify:
	@bash scripts/verify-infra.sh

## reset: DESTRÓI containers, rede E VOLUMES, e sobe do zero (perde TODOS os dados)
reset:
	@echo ">> reset: removendo containers, rede e VOLUMES do projeto movivo..."
	$(COMPOSE) down --volumes --remove-orphans
	@$(MAKE) --no-print-directory up

## nuke: como `reset`, mas também remove as imagens baixadas
nuke:
	$(COMPOSE) down --volumes --remove-orphans --rmi local

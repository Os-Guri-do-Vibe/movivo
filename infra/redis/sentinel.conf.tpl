# =============================================================================
# MOVIVO — Redis SENTINEL (template)
# =============================================================================
# Dono: Henrique (Platform/SRE) · US-0.2 / TASK-0.2.3
# Requisito de origem: ARQUITETURA.md ADR-004 — "réplica + Sentinel (3 nós,
# quorum=2) em produção".
#
# ┌───────────────────────────────────────────────────────────────────────────┐
# │ LIMITAÇÃO CONSCIENTE E DOCUMENTADA DO AMBIENTE DE DEV                     │
# │ A Sprint 0 (TASK-0.2.3) especifica TRÊS containers: master, replica e     │
# │ UM sentinel, com `quorum=2`. Com um único Sentinel no ar, o quorum de 2   │
# │ nunca é alcançado — ou seja: **o failover automático NÃO é exercitável    │
# │ localmente**. Isso é proposital: o valor de quorum aqui é idêntico ao de  │
# │ produção (onde sobem 3 Sentinels), de modo que a configuração testada em  │
# │ dev é a mesma que roda em produção, sem "modo dev" divergente. O que o    │
# │ ambiente local prova é: descoberta do master via Sentinel, autenticação,  │
# │ e o contrato de env consumido pela API. O teste de failover real entra    │
# │ com os 3 nós na sprint de observabilidade/HA (ARQUITETURA.md §10).        │
# │ Baixar o quorum para 1 em dev foi REJEITADO: mascararia em produção um    │
# │ erro de configuração que só apareceria durante um incidente.              │
# └───────────────────────────────────────────────────────────────────────────┘
#
# `@REDIS_PASSWORD@` é substituído no boot a partir de /run/secrets/redis_password
# (mesmo racional do redis-master.conf.tpl — nada em `environment:`, nada em `ps`).
# =============================================================================

port 26379
bind 0.0.0.0
protected-mode no
dir /tmp

# Resolução por hostname é obrigatória aqui: dentro do Compose os nós são
# `redis-master`/`redis-replica`, não IPs fixos. Sem `resolve-hostnames yes` o
# Sentinel recusa o `monitor` por hostname; sem `announce-hostnames yes` ele
# devolveria ao cliente o IP interno da bridge, inútil para uma API rodando no
# host. Com ambos, o cliente recebe `redis-master:6379`.
# → Quem roda a API NO HOST precisa mapear esse nome; ver README §PgBouncer/Redis
#   (ioredis: opção `natMap`).
sentinel resolve-hostnames yes
sentinel announce-hostnames yes

# quorum = 2 (ver caixa acima). O nome `movivo-master` é contrato de env:
# REDIS_SENTINEL_MASTER_NAME em .env.example. Não renomear sem atualizar os dois.
sentinel monitor movivo-master redis-master 6379 2

sentinel auth-pass movivo-master @REDIS_PASSWORD@

# 5s para marcar subjetivamente como down: baixo o suficiente para detecção
# rápida, alto o suficiente para não disparar com um GC pause ou throttling de
# CPU da VPS KVM 2.
sentinel down-after-milliseconds movivo-master 5000
sentinel failover-timeout movivo-master 15000
# 1 réplica ressincronizando por vez — evita saturar I/O da VPS durante failover.
sentinel parallel-syncs movivo-master 1

# O próprio Sentinel exige senha para ser consultado: sem isto, qualquer processo
# na rede interna leria a topologia (endereços dos nós) sem autenticar.
requirepass @REDIS_PASSWORD@

loglevel notice
logfile ""

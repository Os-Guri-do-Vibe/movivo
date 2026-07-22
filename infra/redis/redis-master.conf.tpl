# =============================================================================
# MOVIVO — Redis MASTER (template)
# =============================================================================
# Dono: Henrique (Platform/SRE) · US-0.2 / TASK-0.2.3
# Requisitos de origem:
#   · ARQUITETURA.md §2 / ADR-004 — AOF (appendonly yes, appendfsync everysec)
#     + réplica + Sentinel.
#   · Sprint 0, regra inegociável #2 / ARQUITETURA.md §12.14 —
#     CVE-2025-49844 "RediShell" (CVSS 10): versão mínima 8.2.2 / 8.0.4 /
#     7.4.6 / 7.2.11. A imagem fixada no Compose é redis:8.2.2-alpine.
#   · 11-relatorio-sato.md — bind interno, sem exposição pública, superfície
#     reduzida.
#
# POR QUE ".tpl" E POR QUE O ENTRYPOINT FAZ `sed`:
#   `@REDIS_PASSWORD@` é substituído em tempo de boot pelo conteúdo de
#   /run/secrets/redis_password, gerando o arquivo final em /tmp/redis.conf
#   (dentro do container, tmpfs efêmero). Duas alternativas foram REJEITADAS:
#     1. `environment: REDIS_PASSWORD=...` → proibido por SECURITY.md §2 (vaza
#        em `docker inspect` e em dump de crash).
#     2. `redis-server --requirepass "$(cat ...)"` → a senha apareceria em
#        `ps`/`/proc/<pid>/cmdline` de QUALQUER processo do container e no
#        `docker top`. Pior que o arquivo.
#   O arquivo derivado nunca é persistido em volume e nunca sai do container.
# =============================================================================

# --- Rede ------------------------------------------------------------------
port 6379
# 0.0.0.0 é o interior do container; o isolamento real vem da rede `movivo-net`
# e do fato de a porta ser publicada apenas em 127.0.0.1 no host (nunca 0.0.0.0).
bind 0.0.0.0
protected-mode yes
tcp-backlog 511
tcp-keepalive 60
timeout 0

# --- Autenticação ----------------------------------------------------------
requirepass @REDIS_PASSWORD@
# masterauth/masteruser já definidos no master de propósito: após um failover
# do Sentinel este nó vira réplica do antigo replica e precisa saber autenticar.
masterauth @REDIS_PASSWORD@

# --- Durabilidade (AOF) — ADR-004 -----------------------------------------
# Obrigatório: as filas BullMQ (protocolo, check-in, cobrança) vivem no Redis.
# Perder o AOF é perder job de usuário pagante.
appendonly yes
appendfsync everysec
appendfilename "appendonly.aof"
appenddirname "appendonlydir"
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
aof-use-rdb-preamble yes
dir /data
# RDB mantido como segundo mecanismo (snapshot para restore rápido); AOF é a
# fonte de verdade.
save 900 1
save 300 10
stop-writes-on-bgsave-error yes
rdbcompression yes
rdbchecksum yes

# --- Memória ---------------------------------------------------------------
maxmemory 512mb
# noeviction é OBRIGATÓRIO para BullMQ: com qualquer política de eviction o
# Redis pode descartar as chaves da própria fila sob pressão de memória e os
# jobs somem em silêncio. Sob noeviction, a escrita falha alto e nós vemos.
maxmemory-policy noeviction

# --- Replicação ------------------------------------------------------------
repl-diskless-sync yes
repl-diskless-sync-delay 5
replica-serve-stale-data yes
min-replicas-to-write 0
min-replicas-max-lag 10
# Vale para DEPOIS de um failover, quando este nó passa a ser réplica: anuncia-se
# pelo hostname estável do serviço em vez do IP efêmero da bridge Docker.
replica-announce-ip redis-master
replica-announce-port 6379

# --- Redução de superfície (11-relatorio-sato.md) --------------------------
# Estes três já são "no" por padrão no Redis 7+; declarados explicitamente para
# que um upgrade de imagem que mude o default não passe despercebido.
enable-debug-command no
enable-module-command no
enable-protected-configs no
# NOTA DELIBERADA sobre EVAL/Lua: o scripting NÃO é desabilitado. BullMQ (fila
# oficial da arquitetura) executa toda a sua lógica de atomicidade em EVALSHA —
# desligar Lua quebraria o produto inteiro. O controle contra a RediShell é,
# portanto, exclusivamente a VERSÃO PATCHEADA da imagem (>= 8.2.2), somada a
# rede interna + requirepass. Isto é uma decisão consciente, não um esquecimento:
# qualquer downgrade de imagem reabre uma CVE de CVSS 10.

# --- Log -------------------------------------------------------------------
loglevel notice
logfile ""

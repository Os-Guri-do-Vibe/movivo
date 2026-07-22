# =============================================================================
# MOVIVO — Redis REPLICA (template)
# =============================================================================
# Dono: Henrique (Platform/SRE) · US-0.2 / TASK-0.2.3
# Mesmo racional de segurança e durabilidade do redis-master.conf.tpl; leia
# aquele arquivo primeiro. Aqui só as diferenças estão comentadas.
# =============================================================================

port 6379
bind 0.0.0.0
protected-mode yes
tcp-keepalive 60
timeout 0

requirepass @REDIS_PASSWORD@
masterauth @REDIS_PASSWORD@

# --- Replicação ------------------------------------------------------------
# `replicaof` estático aponta o primeiro boot; a partir daí quem manda é o
# Sentinel, que reescreve esta diretiva via CONFIG SET/REWRITE durante um
# failover. Por isso o arquivo efetivo vive em /tmp (gravável) e não no bind
# mount somente-leitura: um Sentinel que não consegue reescrever a config do
# nó registra erro e o failover fica inconsistente.
replicaof redis-master 6379
replica-read-only yes
replica-serve-stale-data yes
replica-priority 100
# Sem isto, a réplica se anuncia ao master (e portanto ao Sentinel, e portanto
# ao cliente) pelo IP efêmero da bridge Docker (172.18.x.y), que muda a cada
# `docker compose down`. Anunciando o hostname do serviço, o endereço devolvido
# pelo Sentinel é estável e mapeável pelo `natMap` do ioredis quando a API roda
# no host. Depende de `sentinel resolve-hostnames yes` no Sentinel.
replica-announce-ip redis-replica
replica-announce-port 6379

# --- Durabilidade ----------------------------------------------------------
appendonly yes
appendfsync everysec
appendfilename "appendonly.aof"
appenddirname "appendonlydir"
dir /data
save 900 1

# --- Memória ---------------------------------------------------------------
maxmemory 512mb
maxmemory-policy noeviction

# --- Redução de superfície -------------------------------------------------
enable-debug-command no
enable-module-command no
enable-protected-configs no

loglevel notice
logfile ""

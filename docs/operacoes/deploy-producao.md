# Runbook — Produção na VPS (Hostinger)

**Dono:** Henrique (Platform/SRE) · **Criado em:** 2026-09-24 (1º deploy)

Como a MOVIVO roda em produção, como fazer deploy, voltar versão, restaurar
backup e onde ficam os segredos. Os arquivos citados estão em `infra/vps/`.

## Visão geral

```
Visitante ──HTTPS──▶ Cloudflare (proxy, WAF, SSL Full strict)
                         │  443, só faixas IPv4 do Cloudflare (firewall Hostinger)
                         ▼
              VPS 187.127.40.87 · /opt/movivo · Docker Compose
              nginx ─┬─▶ web  (Next.js)      movivo.com.br
                     └─▶ api  (NestJS)       api.movivo.com.br
                           ├─▶ pgbouncer ─▶ postgres (pgvector)
                           ├─▶ redis-sentinel ─▶ redis-master / redis-replica
                           └─▶ evolution-api ─▶ evolution-postgres  (WhatsApp)
```

| Item | Valor |
|---|---|
| VPS | Hostinger KVM 2 (2 vCPU, 8 GB, 100 GB), Campinas, VM `2006496` |
| Acesso | `ssh deploy@187.127.40.87` (só chave; root bloqueado) |
| Stack | `/opt/movivo/compose.yml` (cópia de `infra/vps/docker-compose.prod.yml`) |
| Versão no ar | `/opt/movivo/.env` → `MOVIVO_VERSION` (SHA curto) |
| Imagens | `ghcr.io/os-guri-do-vibe/movivo-{api,web}:<sha>` |
| Segredos | `/opt/movivo/secrets/` (700, dono `deploy`) |
| Backups | `/opt/movivo/backups/` (7 dias) + backup semanal da Hostinger |

Nenhuma porta além da 443 é publicada. Postgres, Redis e EvolutionAPI só
existem na rede interna `movivo-net`.

## Deploy

**Caminho normal (quando o `deploy.yml` estiver no `main`):** merge no `main` →
o workflow **Deploy** constrói as imagens, publica no GHCR e roda
`infra/vps/deploy.sh <sha>` contra a VPS.

**Manual, do Mac (raiz do repo):**

```bash
infra/vps/deploy.sh --build   # constrói na VPS a partir do HEAD commitado
infra/vps/deploy.sh <sha>     # usa imagens já publicadas no GHCR
```

O script: sincroniza a configuração → cria os segredos que faltam → confere o
certificado → imagens → sobe a camada de dados → `migrate` → API, web e Nginx
→ timers de backup e higiene do Docker → smoke test pelo Cloudflare. Ele para
no primeiro erro.

Configuração (compose, `api.env`, Nginx) vem da **árvore de trabalho**; as
imagens vêm do **commit**. Mudou `api.env`? Basta rodar o deploy de novo.

## Rollback

```bash
infra/vps/deploy.sh --rollback   # api/web voltam para MOVIVO_PREVIOUS_VERSION
```

Migrações são só para frente: o rollback troca a imagem, não desfaz o schema.
Toda migração precisa manter a versão anterior da API funcionando.

## Operação do dia a dia (na VPS)

```bash
cd /opt/movivo
docker compose ps                      # estado e health de tudo
docker compose logs -f --tail 100 api  # logs da API (JSON, PII redigida)
docker compose restart api
curl -s https://api.movivo.com.br/api/v1/health
```

Não edite `/opt/movivo/compose.yml` nem `api.env` à mão: edite no repo e rode o
deploy (senão a próxima execução desfaz a mudança).

### Disco, imagens e logs

O daemon usa o driver de log `local`, limitado a 5 arquivos de 20 MB por
container. Todo domingo às 05:30 BRT, `movivo-docker-prune.timer` remove cache
de build sem uso e imagens dangling com mais de sete dias. A rotina não remove
containers, volumes nem imagens versionadas disponíveis para rollback.

```bash
docker system df
systemctl list-timers movivo-docker-prune.timer --no-pager
journalctl -u movivo-docker-prune.service -n 100 --no-pager
sudo systemctl start movivo-docker-prune.service  # execução manual segura
```

## Segredos

| Origem | Arquivos |
|---|---|
| Gerados **na VPS** por `gen-prod-secrets.sh` | senhas do Postgres/Redis/Evolution, `pgcrypto_key`, par JWT, `evolution_webhook_token`, `asaas_webhook_secret`, `backup_encryption_key` |
| Provisionados na VPS ou copiados de `PRODUCTION_SECRETS_DIR` explícito (só se faltarem) | `asaas_api_key`, `openai_api_key`, `anthropic_api_key`, `deepseek_api_key`, `groq_api_key` |

Credenciais de terceiros devem ser exclusivas de produção. O deploy não usa `secrets/`
de desenvolvimento como fallback. Para arquivos ainda ausentes, execute
`PRODUCTION_SECRETS_DIR=/caminho/privado/producao infra/vps/deploy.sh <sha>`.
Mantenha a fonte fora do Git e com modo `0700`.

- O script **nunca sobrescreve** um segredo existente. Trocar a senha do
  Postgres ou o `pgcrypto_key` com o banco criado quebra o acesso ou torna dado
  de saúde ilegível — rotação é procedimento próprio (`docs/SECURITY.md`).
- Trocar chave de API externa: use o helper validado descrito em “Atualizar
  credenciais de fornecedores” abaixo; nunca substitua arquivos manualmente.
- `backup_encryption_key` e `pgcrypto_key`: sem a primeira os dumps são
  inúteis; sem a segunda o dado de saúde restaurado fica ilegível. Há cópia de
  ambas no Keychain do Rodrigo (`movivo-backup-encryption-key`,
  `movivo-pgcrypto-key`, conta `movivo-prod`) — **mantenha ao menos uma cópia
  com outro fundador** e atualize se alguma chave for rotacionada.

### Travas em produção (`api.env`)

- `LLM_*_HEALTH_DATA_APPROVED` e `STT_*_HEALTH_DATA_APPROVED`: **fechadas** até
  o DPA de cada provedor (ADR-005-R2). O protocolo sai pelo `FALLBACK_TEMPLATE`
  com revisão CREF.
- `KNOWLEDGE_OPENAI_EMBEDDING_HEALTH_DATA_APPROVED`: **aberta** por decisão do
  Rodrigo (2026-09-24) — a API não sobe em produção com ela fechada.
- Asaas travado no Sandbox pelo schema; `PAYMENT_PROVIDER=MOCK` é recusado em
  produção.

## TLS e Cloudflare

- Certificado de origem: Cloudflare Origin CA (15 anos) em
  `/opt/movivo/nginx/certs/`. A chave privada nasce na VPS e nunca sai de lá.
- Emitir/renovar e ligar o SSL Full (strict): `infra/vps/cloudflare-origin.sh
  [--renew] [--strict]`. Token no Keychain (`cloudflare-api-token`), escopo só na
  zona.
- O Nginx recusa (444) qualquer conexão que não venha do Cloudflare e não
  completa o TLS para hostname desconhecido.
- Cloudflare mudou as faixas de IP? Rode `bash infra/vps/hostinger-firewall.sh`
  (firewall da Hostinger) **e** um deploy (listas do Nginx).

Credenciais de terceiros devem ser exclusivas do ambiente de produção. O deploy não usa `secrets/` de desenvolvimento como fallback. Para provisionar arquivos ainda ausentes, execute `PRODUCTION_SECRETS_DIR=/caminho/privado/producao infra/vps/deploy.sh <sha>`; mantenha esse diretório fora do Git e com modo `0700`. Valores existentes na VPS não são sobrescritos: rotação exige substituição coordenada e recriação dos consumidores.

## Backup e restauração

| Camada | O que | Frequência | Retenção | RPO |
|---|---|---|---|---|
| Local (VPS) | `pg_dump` do `movivo` e do `evolution` + tar dos uploads, AES-256 (`backup_encryption_key`), verificado após a escrita | diário 03:30 BRT | 7 dias + 4 cópias de domingo em `backups/weekly/` (≈35 dias) | ≤ 24 h |
| Teste de restore | restaura o dump mais recente num Postgres descartável (sem rede, tmpfs) e confere tabelas, RLS, extensões e contagem de linhas | semanal, domingo 04:30 BRT | — | — |
| Fora da VPS (provedor) | backup semanal automático da Hostinger (disco inteiro) | semanal | decide a Hostinger | ≤ 7 dias |
| Fora da VPS (isolada) | `infra/vps/backup/pull-offsite.sh` no Mac puxa `weekly/` (sem as chaves) | sob demanda/semanal | 35 dias | ≤ 7 dias |

Não há PITR/WAL archiving (decisão de 2026-10-06: sem clientes e sem orçamento;
revisar no gatilho abaixo). O banco local diário custa ~1 MB por dump — por isso
fica diário mesmo com o resto em cadência semanal.

**Gatilho para subir o nível** (qualquer um): primeiro assinante pagante, dado
real de aluno que não se reproduz, ou banco > 1 GB. Aí: WAL archiving com
`pgBackRest`/`wal-g` para storage externo e cópia diária fora do provedor.

### Rotina

```bash
sudo systemctl start movivo-backup.service         # backup agora
journalctl -u movivo-backup.service -n 20          # resultado do último
sudo systemctl start movivo-restore-test.service   # teste de restore agora (~15 s)
cat /opt/movivo/backups/restore-test.status        # última execução: OK ou FALHA
systemctl list-timers 'movivo-*' --no-pager        # próximos disparos
systemctl is-failed movivo-backup.service movivo-restore-test.service
```

O teste de restore **reprova** (e deixa a unit em `failed`) se: o backup mais
novo tem > 36 h, a chave não decifra, o dump está truncado/corrompido, o
`pg_restore` dá qualquer erro, o banco volta sem tabelas/RLS ou faltam as
extensões `vector`, `pgcrypto`, `uuid-ossp`. **Ainda não há alerta ativo**: quem
olha é o `is-failed` acima (ver Pendências).

Cópia fora da VPS (rodar no Mac, ex.: toda segunda):

```bash
infra/vps/backup/pull-offsite.sh        # -n para simular; DEST=... para trocar o destino
```

### Restaurar (perda de dados no banco principal)

Prefira **não** restaurar por cima da produção: valide primeiro num container
descartável (`movivo-restore-test.sh` faz isso) e só então aplique.

```bash
docker compose stop api
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -pass file:/opt/movivo/secrets/backup_encryption_key \
  -in backups/movivo-AAAAMMDD-HHMM.dump.enc \
| docker exec -i movivo-postgres pg_restore -U postgres -d movivo --clean --if-exists
docker compose run --rm migrate && docker compose up -d api
```

### Perda total da VPS

1. Recriar a VPS (`bootstrap.sh`), apontar `deploy.sh` — ele sobe a stack com
   banco vazio e roles novas.
2. Recolocar `backup_encryption_key` e `pgcrypto_key` **a partir do Keychain** em
   `/opt/movivo/secrets/` (a `pgcrypto_key` precisa ser a mesma do dado
   restaurado; `gen-prod-secrets.sh` não sobrescreve segredo existente).
3. Trazer um `.enc` (backup da Hostinger restaura o disco inteiro, ou o `weekly/`
   puxado para o Mac) e rodar o `pg_restore` acima.

O restore **de um disco inteiro pela Hostinger nunca foi exercitado** (substitui
a VM; só faz sentido testar num VPS descartável). O caminho por dump é o que
está coberto pelo teste semanal.

## Configurar o deploy automático (uma vez)

1. Chave SSH dedicada ao Actions (no Mac):
   ```bash
   ssh-keygen -t ed25519 -N '' -C github-actions-deploy -f /tmp/movivo-actions
   ssh deploy@187.127.40.87 'cat >> ~/.ssh/authorized_keys' < /tmp/movivo-actions.pub
   gh secret set VPS_SSH_KEY --env production < /tmp/movivo-actions
   ssh-keyscan -t ed25519 187.127.40.87 | gh secret set VPS_KNOWN_HOSTS --env production
   rm /tmp/movivo-actions /tmp/movivo-actions.pub
   ```
2. Merge do `deploy.yml` no `main`. O primeiro push publica as imagens.

## Pendências conhecidas

- Deploy automático: secrets do environment `production` (acima).
- Observabilidade: sem Sentry/uptime externo ainda — hoje o sinal é o
  healthcheck do Docker e o smoke test do deploy.
- Backup: sem alerta ativo se `movivo-backup`/`movivo-restore-test` falharem ou
  atrasarem (só `systemctl is-failed` e `restore-test.status`). Ligar a um canal
  (e-mail/WhatsApp/healthchecks.io) junto com o uptime externo.
- Backup: definir o `[PRAZO DE BACKUP]` da Política de Privacidade (a retenção
  efetiva hoje é de até 35 dias) — decisão jurídica de Alexandre.
- Authenticated Origin Pulls (mTLS Cloudflare → Nginx): recomendado, não ligado.

## Links revogáveis e logs seguros (auditoria 2026-10-05)

A autorização dos links públicos usa credencial aleatória, finalidade, recurso,
TTL e revogação server-side. O banco guarda só SHA-256 do bearer. IDs antigos de
usuário/protocolo e checkout AES legado falham fechados. Aliases também são
hashados; destinos são criptografados com a PGCRYPTO_KEY runtime já existente.
Não troque IDs nem a chave de dados para revogar acesso. O deploy e o rollback
recusam imagens sem a capacidade `revocable-v1` após esta mudança.

O access log não registra URI/query/Referer/User-Agent. O erro nativo passa por FIFO
0600 em tmpfs e um coletor AWK antes do driver Docker: timestamp, severidade,
categoria, errno e conexão são preservados, mensagem/URI/PII são descartadas. A
falha do coletor encerra o Nginx para restart e aparece no healthcheck. Não há
supressão de erros nem denylist de tokens na solução permanente.

## Atualizar credenciais de fornecedores

Os cinco arquivos são `asaas_api_key` (Sandbox), `openai_api_key`,
`anthropic_api_key`, `deepseek_api_key` e `groq_api_key`. AraraHQ não é dependência
runtime. Evolution usa suas credenciais próprias, diferentes das dos LLMs.
`api.env` contém apenas ponteiros `*_FILE`, nunca os valores. Segredos não participam
do build das imagens. Gere chave exclusiva desta instalação no console correto;
não reutilize a chave de desenvolvimento.

O script instalado em `/opt/movivo/bin/update-provider-secret.sh` recebe a chave
por stdin, valida uma chamada GET autenticada ao fornecedor sem seguir redirects,
substitui o arquivo atomicamente e recria apenas a API. Se a API não ficar saudável,
restaura a anterior. **Revogue a anterior no console apenas após sucesso.** Asaas
permanece Sandbox até a aprovação do gate PCI; não use chave de produção aqui.

No terminal zsh do Mac (a entrada fica oculta e não vira argumento/histórico):

```sh
read -rs 'movivo_key?Cole a nova chave: '
printf '\n'
printf '%s\n' "$movivo_key" | ssh -T deploy@187.127.40.87 '/opt/movivo/bin/update-provider-secret.sh openai_api_key'
unset movivo_key
```

Troque apenas o nome final por um dos cinco arquivos. Outra opção é arquivo privado
modo 0600 enviado com redirecionamento stdin. Não cole a chave em chat, issue, logs
ou argumento de comando. A validação confirma autenticação; confirme também o
fluxo funcional correspondente (LLM/embedding/STT ou pagamento Sandbox) antes de
revogar a anterior. As aprovações de tratamento de dados de saúde continuam vigentes.

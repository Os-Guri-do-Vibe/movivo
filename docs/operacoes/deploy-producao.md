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
→ timer de backup → smoke test pelo Cloudflare. Ele para no primeiro erro.

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

## Segredos

| Origem | Arquivos |
|---|---|
| Gerados **na VPS** por `gen-prod-secrets.sh` | senhas do Postgres/Redis/Evolution, `pgcrypto_key`, par JWT, `evolution_webhook_token`, `asaas_webhook_secret`, `backup_encryption_key` |
| Copiados do dev pelo `deploy.sh` (só se faltarem) | `asaas_api_key`, `openai_api_key`, `anthropic_api_key`, `deepseek_api_key`, `groq_api_key`, `ararahq_api_key` |

- O script **nunca sobrescreve** um segredo existente. Trocar a senha do
  Postgres ou o `pgcrypto_key` com o banco criado quebra o acesso ou torna dado
  de saúde ilegível — rotação é procedimento próprio (`docs/SECURITY.md`).
- Trocar uma chave de API externa: edite o arquivo direto na VPS e rode
  `docker compose up -d --force-recreate api`.
- `backup_encryption_key`: sem ela os dumps são inúteis. Guarde uma cópia no
  gerenciador de senhas dos fundadores.

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

## Backup e restauração

`movivo-backup.timer` roda às 03:30 BRT: `pg_dump` do `movivo` e do `evolution`
+ tar dos uploads, cifrados com AES-256 (`backup_encryption_key`), 7 dias de
retenção. Não há cópia fora da Hostinger (decisão de 2026-09-24); a proteção
contra perda da VPS é o backup semanal/snapshot da Hostinger.

```bash
sudo systemctl start movivo-backup.service   # backup agora
journalctl -u movivo-backup.service -n 20    # resultado do último

# Restaurar o banco principal (PARE a API antes):
docker compose stop api
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -pass file:/opt/movivo/secrets/backup_encryption_key \
  -in backups/movivo-AAAAMMDD-HHMM.dump.enc \
| docker exec -i movivo-postgres pg_restore -U postgres -d movivo --clean --if-exists
docker compose run --rm migrate && docker compose up -d api
```

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
- Authenticated Origin Pulls (mTLS Cloudflare → Nginx): recomendado, não ligado.

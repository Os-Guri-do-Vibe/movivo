# `secrets/` — credenciais dos ambientes

> **Este é o único arquivo deste diretório que vai para o Git.**
> Todo o resto é ignorado por `.gitignore` (`secrets/*` + exceção para este README
> e para o `.gitkeep`). Se você vir qualquer outro arquivo daqui aparecendo em
> `git status`, **pare** e avise Henrique — é um incidente de segurança.

## Estrutura

```
secrets/
├── desenvolvimento/   # ambiente local — valores descartáveis + chaves de dev
└── producao/          # fontes das credenciais de produção — você preenche
```

| Pasta             | O que guarda                                                                                  | Quem lê                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `desenvolvimento` | Fontes dos Docker Secrets locais, certificados TLS internos (`internal_tls/`), chaves de dev. | `docker-compose.secrets.yml`, `docker-compose.override.yml`, API no host (`apps/api/.env`), testes. |
| `producao`        | Credenciais de produção. Os arquivos nascem **vazios**; preencha o que for seu.               | `infra/vps/deploy.sh` (copia para `/opt/movivo/secrets/` só o que faltar lá). Nada local lê daqui.  |

Na VPS o layout é **plano** (`/opt/movivo/secrets/<nome>`); `secrets/producao/` é só a
fonte que o `deploy.sh` usa para alimentá-lo. Nunca reutilize um valor de
`desenvolvimento` em `producao` — o `deploy.sh` recusa chaves de terceiros idênticas.

## `desenvolvimento/`

Os arquivos são as **fontes** dos Docker Secrets declarados em
[`docker-compose.secrets.yml`](../docker-compose.secrets.yml). O Docker os monta
dentro dos containers em `/run/secrets/<nome>`, **somente leitura** e fora da imagem.
A aplicação os lê pelo contrato `*_FILE` documentado em
[`docs/SECURITY.md`](../docs/SECURITY.md).

### Como gerar

```bash
# Linux / macOS / Git Bash no Windows
bash scripts/gen-local-secrets.sh
```

```powershell
# Windows nativo
powershell -ExecutionPolicy Bypass -File scripts/gen-local-secrets.ps1
```

Ambos são **idempotentes**: rodar de novo não sobrescreve o que já existe. Para
rotacionar tudo, use `--force` (bash) ou `-Force` (PowerShell) — e depois recrie
os volumes do Postgres, porque a senha de uma role já criada não muda sozinha.
Só geram em `desenvolvimento/`; nunca tocam em `producao/`.

### Arquivos gerados

| Arquivo                       | Consumido por                                                              | Variável da aplicação              |
| ----------------------------- | -------------------------------------------------------------------------- | ---------------------------------- |
| `postgres_superuser_password` | entrypoint do Postgres (bootstrap)                                         | `POSTGRES_PASSWORD_FILE`           |
| `postgres_app_password`       | API em runtime (role `movivo_app`)                                         | `DATABASE_PASSWORD_FILE`           |
| `postgres_migrator_password`  | drizzle-kit (role `movivo_migrator`)                                       | `MIGRATION_DATABASE_PASSWORD_FILE` |
| `redis_password`              | Redis master/replica/sentinel + API                                        | `REDIS_PASSWORD_FILE`              |
| `pgbouncer_userlist.txt`      | `auth_file` do PgBouncer                                                   | — (só o pooler lê)                 |
| `pgcrypto_key`                | criptografia de dados de saúde (Sprint 2)                                  | `PGCRYPTO_KEY_FILE`                |
| `evolution_postgres_password` | Postgres dedicado da EvolutionAPI                                          | — (só o `command` do serviço lê)   |
| `evolution_api_key`           | `AUTHENTICATION_API_KEY` da EvolutionAPI + `EVOLUTION_API_KEY_FILE` da API | ambos                              |
| `evolution_webhook_token`     | webhook de ENTRADA da EvolutionAPI (US-3.1-EVO) — só a API                 | `EVOLUTION_WEBHOOK_TOKEN_FILE`     |

Colocados à mão (chaves de terceiros, exclusivas de desenvolvimento): `asaas_api_key`
(Sandbox), `asaas_webhook_secret`, `openai_api_key`, `deepseek_api_key`,
`anthropic_api_key`, `groq_api_key`. Gerados por `scripts/provision-security.py`:
`internal_tls/`, `health_cipher_keyring`, `vault_token`.

## `producao/`

Só as credenciais de fornecedores, que **você** obtém e preenche. O `deploy.sh` copia
cada uma para a VPS apenas se ela estiver **faltando** lá (nunca sobrescreve):

`asaas_api_key`, `asaas_webhook_secret`, `deepseek_api_key`, `openai_api_key`,
`anthropic_api_key`, `groq_api_key`.

Todo o resto é **gerado na própria VPS** e não tem arquivo aqui, de propósito — nunca
passa pelo Mac:

- `infra/vps/gen-prod-secrets.sh`: `postgres_*`, `redis_password`, `pgcrypto_key`,
  `jwt_*`, `evolution_*`, `backup_encryption_key`.
- `scripts/provision-security.py`: `internal_tls/` (a chave da CA fica na custódia do
  operador), `health_cipher_keyring`, `vault_token`.

`pgcrypto_key` e `backup_encryption_key` são insubstituíveis (perdê-las inutiliza o dado
de saúde e os backups); a cópia de segurança fica no Keychain — ver
`docs/operacoes/deploy-producao.md`.

## Regras

1. **Nunca** commite, cole em chat/issue/PR, nem imprima o conteúdo destes arquivos.
2. **Nunca** reutilize um valor de `desenvolvimento/` em staging ou produção.
3. **Nunca** mova um destes valores para `environment:` do Compose — vaza em
   `docker inspect` (Sato §9.3).
4. Mantenha o diretório `secrets/` e as subpastas em modo `0700`, e os arquivos de
   `producao/` em `0600`.
5. Se suspeitar de exposição, rotacione (`--force`) e recrie os volumes.

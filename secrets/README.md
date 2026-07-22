# `secrets/` — Docker Secrets do ambiente local

> **Este é o único arquivo deste diretório que vai para o Git.**
> Todo o resto é ignorado por `.gitignore` (`secrets/*` + exceção para este README
> e para o `.gitkeep`). Se você vir qualquer outro arquivo daqui aparecendo em
> `git status`, **pare** e avise Henrique — é um incidente de segurança.

## O que é isto

Os arquivos deste diretório são as **fontes** dos Docker Secrets declarados em
[`docker-compose.secrets.yml`](../docker-compose.secrets.yml). O Docker os monta
dentro dos containers em `/run/secrets/<nome>`, **somente leitura** e fora da imagem
(bind read-only no Compose standalone; tmpfs no Swarm/Vault da Fase B). A aplicação
os lê pelo contrato `*_FILE` documentado em [`SECURITY.md`](../SECURITY.md).

Nada aqui é senha "de verdade": são valores aleatórios descartáveis, válidos
apenas para a sua máquina.

## Como gerar

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

## Arquivos gerados

| Arquivo                       | Consumido por                             | Variável da aplicação              |
| ----------------------------- | ----------------------------------------- | ---------------------------------- |
| `postgres_superuser_password` | entrypoint do Postgres (bootstrap)        | `POSTGRES_PASSWORD_FILE`           |
| `postgres_app_password`       | API em runtime (role `movivo_app`)        | `DATABASE_PASSWORD_FILE`           |
| `postgres_migrator_password`  | drizzle-kit (role `movivo_migrator`)      | `MIGRATION_DATABASE_PASSWORD_FILE` |
| `redis_password`              | Redis master/replica/sentinel + API       | `REDIS_PASSWORD_FILE`              |
| `pgbouncer_userlist.txt`      | `auth_file` do PgBouncer                  | — (só o pooler lê)                 |
| `pgcrypto_key`                | criptografia de dados de saúde (Sprint 2) | `PGCRYPTO_KEY_FILE`                |

## Regras

1. **Nunca** commite, cole em chat/issue/PR, nem imprima o conteúdo destes arquivos.
2. **Nunca** reutilize um valor daqui em staging ou produção.
3. **Nunca** mova um destes valores para `environment:` do Compose — vaza em
   `docker inspect` (Sato §9.3).
4. Se suspeitar de exposição, rotacione (`--force`) e recrie os volumes.

# Política de Segredos — MOVIVO

**Dono deste documento:** Henrique Matsuda (Platform Engineering / SRE)
**Requisito de origem:** `docs/fitness-ia-whatsapp/11-relatorio-sato.md` §9.3 · `docs/arquitetura/ARQUITETURA.md` §8 e §12.7
**Entregue em:** Sprint 0 — US-0.6
**Público:** todo dev do repositório. Leonardo (US-0.3) e Felipe (US-0.5) implementam o §2.

> **Regra zero, inegociável:** nenhum segredo real entra no Git. Nunca. Em nenhuma
> branch, em nenhum commit, nem "temporariamente". O que é versionado é apenas
> `*.env.example` com placeholders.

---

## 1. Modelo de gestão de segredos por ambiente

| Ambiente                   | Onde o segredo vive                                  | Como chega na aplicação                                                          |
| -------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Local (dev)**            | Arquivos em `secrets/` (gerados, no `.gitignore`)    | Docker Secrets → `/run/secrets/<nome>` (somente leitura) → variável `<VAR>_FILE` |
| **CI (GitHub Actions)**    | GitHub Actions Secrets (escopo repositório/ambiente) | Contexto `${{ secrets.* }}` → env do step, mascarado no log                      |
| **Produção (MVP, Fase A)** | Docker Secrets na VPS                                | Idêntico ao local: `/run/secrets/*` + `<VAR>_FILE`                               |
| **Produção (Fase B)**      | HashiCorp Vault / AWS Secrets Manager                | Injeção em `/run/secrets/*` pelo agente; **o contrato `*_FILE` não muda**        |

O contrato `*_FILE` foi escolhido exatamente para que a migração para Vault na
Fase B (Sato §9.3) **não exija tocar em uma linha de código de aplicação** — muda
apenas quem escreve o arquivo.

**Proibições absolutas:**

- ❌ Segredo em `environment:` de qualquer serviço do Compose — vaza em
  `docker inspect`, em `docker compose config`, no `/proc` do host e em logs de crash.
- ❌ Segredo embutido em `Dockerfile` (`ENV`/`ARG`) — fica na camada da imagem para sempre.
- ❌ Segredo em variável `NEXT_PUBLIC_*` — é inlined no bundle e vai para o browser.
- ❌ Segredo em log, mensagem de erro, span de telemetria, resposta de `/health` ou issue/PR.
- ❌ Segredo hardcoded em workflow YAML.
- ❌ Reutilizar um segredo de dev em staging/produção (ou vice-versa).

---

## 2. Contrato de consumo de secrets (`*_FILE`) — **normativo**

Este é o contrato que o `ConfigModule` (TASK-0.3.2, Leonardo) **deve** implementar,
e que o `apps/web` segue para secrets de servidor. É normativo: divergir dele quebra
o ambiente local e a Fase B.

### 2.1 Regras

1. **Nomenclatura.** Para toda chave de configuração `K` cujo valor é sensível,
   existe uma variável irmã opcional **`K_FILE`**. Exemplo: `DATABASE_PASSWORD` ↔
   `DATABASE_PASSWORD_FILE`. Não invente outro sufixo.

2. **Resolução acontece ANTES da validação Zod.** Um passo de _preload_
   (`resolveFileSecrets()`) monta o objeto de configuração bruto; só o resultado
   desse passo é entregue ao schema Zod. O Zod nunca vê `K_FILE`.

3. **Ordem de precedência, por chave `K`:**
   1. Se **`K_FILE`** estiver definida e não-vazia → **lê o arquivo**. Este valor vence.
   2. Senão, se **`K`** estiver definida → usa o valor da env direta.
   3. Senão → a chave é considerada **ausente**, e o Zod falha o boot com mensagem
      citando **os dois** nomes (`"defina DATABASE_PASSWORD_FILE ou DATABASE_PASSWORD"`).

4. **`K_FILE` nunca degrada silenciosamente.** Se `K_FILE` está definida mas o
   arquivo não existe, não é legível, ou está vazio após o trim → **erro fatal de
   boot**. Jamais cair de volta para `K`. Um fallback silencioso é como uma senha
   de dev vaza para produção.

5. **Resolução de caminho.** Caminho absoluto é usado como está
   (`/run/secrets/postgres_app_password` dentro do container). Caminho relativo é
   resolvido contra `process.cwd()` (`../../secrets/postgres_app_password` quando a
   API roda no host a partir de `apps/api`).

6. **Normalização do conteúdo.** Ler como UTF-8, remover um BOM inicial se houver,
   e aplicar `trimEnd()` (remove `\n`, `\r\n` e espaços finais). **Não** aplicar
   `trim()` completo: um segredo pode legitimamente começar com espaço. Se o
   resultado for string vazia → erro fatal (regra 4).

7. **Ambas definidas.** Se `K_FILE` e `K` estiverem presentes, `K_FILE` vence e é
   emitido um `warn` citando **apenas o nome** da variável — nunca o valor, nunca
   um prefixo do valor.

8. **Não reinjetar em `process.env`.** O valor resolvido vive apenas dentro do
   `ConfigService`. Escrever de volta em `process.env` o expõe a processos filhos,
   a dumps de crash e a libs que serializam o ambiente.

9. **Nunca logar o valor.** Nem em `debug`, nem mascarado parcialmente. Mensagens
   de erro citam somente o nome da variável e o caminho do arquivo.

10. **Marcação no schema.** Toda chave sensível deve ser marcada como tal no schema
    Zod (ex.: helper `secret(z.string().min(1))`), para que o serializador de
    configuração e o `/health` possam omiti-las por construção, e não por
    disciplina de quem escreve o código.

### 2.2 Chaves sensíveis já existentes na Sprint 0

| Chave `K`                     | `K_FILE` (valor no Compose)               | `K_FILE` (valor rodando no host)           |
| ----------------------------- | ----------------------------------------- | ------------------------------------------ |
| `DATABASE_PASSWORD`           | `/run/secrets/postgres_app_password`      | `../../secrets/postgres_app_password`      |
| `MIGRATION_DATABASE_PASSWORD` | `/run/secrets/postgres_migrator_password` | `../../secrets/postgres_migrator_password` |
| `REDIS_PASSWORD`              | `/run/secrets/redis_password`             | `../../secrets/redis_password`             |
| `REDIS_SENTINEL_PASSWORD`     | `/run/secrets/redis_password`             | `../../secrets/redis_password`             |

Chaves das próximas sprints (`JWT_PRIVATE_KEY`, `PGCRYPTO_KEY`, `ARARAHQ_WEBHOOK_SECRET`,
`STRIPE_SECRET_KEY`, `OPENAI_API_KEY`, …) seguem exatamente o mesmo contrato e já
estão listadas comentadas em `.env.example`.

### 2.3 Referência de implementação (esboço — Leonardo adapta ao NestJS)

```ts
// apps/api/src/core/config/resolve-file-secrets.ts
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

/** Chaves cujo valor é sensível e aceita o par `<K>_FILE`. */
export const SECRET_KEYS = [
  'DATABASE_PASSWORD',
  'MIGRATION_DATABASE_PASSWORD',
  'REDIS_PASSWORD',
  'REDIS_SENTINEL_PASSWORD',
] as const;

export function resolveFileSecrets(
  env: NodeJS.ProcessEnv,
  keys: readonly string[] = SECRET_KEYS,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { ...env };

  for (const key of keys) {
    const filePath = env[`${key}_FILE`]?.trim();
    if (!filePath) continue; // cai para a env direta; ausência é problema do Zod

    const abs = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
    let raw: string;
    try {
      raw = readFileSync(abs, 'utf8');
    } catch (cause) {
      // Falha fatal e explícita — nunca fallback silencioso para env direta.
      throw new Error(`${key}_FILE aponta para "${abs}", que não pôde ser lido.`, { cause });
    }

    const value = raw.replace(/^\uFEFF/, '').trimEnd(); // BOM defensivo + trim final
    if (value.length === 0) {
      throw new Error(`${key}_FILE aponta para "${abs}", mas o arquivo está vazio.`);
    }
    if (env[key] !== undefined) {
      logger.warn(`${key} e ${key}_FILE definidos; ${key}_FILE tem precedência.`);
    }

    out[key] = value;
    delete out[`${key}_FILE`]; // o schema Zod não deve ver o par
  }
  return out;
}
```

O `ConfigModule` chama `resolveFileSecrets(process.env)` e passa o retorno ao
`safeParse` do schema Zod. O boot falha se o parse falhar (fail-fast, TASK-0.3.2).

### 2.4 Como o Compose entrega os arquivos (US-0.2)

- Bloco top-level `secrets:` canônico: [`docker-compose.secrets.yml`](docker-compose.secrets.yml).
- **Nota de precisão técnica:** no Compose _standalone_ (nosso caso no MVP) cada
  secret é montado como **bind mount somente leitura** do arquivo em
  `/run/secrets/<nome>`; é no **Swarm/Vault (Fase B)** que ele vira **tmpfs** e nunca
  toca o disco. Em ambos os modos a propriedade que importa é a mesma: o valor está
  **fora da imagem, fora de `environment:` e fora do `docker inspect`** — verificado
  na US-0.6.
- O Postgres oficial suporta nativamente o mesmo padrão: `POSTGRES_PASSWORD_FILE`,
  `POSTGRES_USER_FILE`, `POSTGRES_DB_FILE`, `POSTGRES_INITDB_ARGS_FILE`.
- O Redis **não** tem suporte nativo a `*_FILE`: a senha entra pelo `command`, lida
  do secret em tempo de execução
  (`redis-server ... --requirepass "$(cat /run/secrets/redis_password)"`), nunca por `environment:`.
- O PgBouncer usa `auth_file` apontando para `/run/secrets/pgbouncer_userlist` com
  `auth_type = scram-sha-256`.

---

## 3. Segredos de CI (GitHub Actions) — TASK-0.6.4

### 3.1 Situação na Sprint 0

**A Sprint 0 não requer nenhum segredo de CI.** O pipeline (`lint → typecheck →
test → build` + `secret-scan → SAST → SCA`, US-0.7) roda inteiramente com o
`GITHUB_TOKEN` efêmero que o Actions injeta por job. Não há deploy nesta sprint,
logo não há credencial de produção no CI. Qualquer PR que introduza um segredo de
CI na Sprint 0 deve ser recusado.

### 3.2 Regras permanentes

1. **Nada de token de longa duração.** Quando o deploy existir (Sprint 6+), a
   autenticação com o provedor será por **OIDC** (federação de identidade, credencial
   efêmera por job). PAT e access key estática só com exceção documentada, datada e
   assinada por Henrique + Sato.
2. **Menor privilégio por workflow.** Todo workflow declara `permissions:` no topo
   com o mínimo (`contents: read` como padrão) e eleva por job apenas onde precisar
   (`packages: write`, `security-events: write`).
3. **Nada de segredo em YAML.** Sempre pelo contexto `${{ secrets.NOME }}`, atribuído
   a `env:` do step que precisa — nunca no `env:` global do workflow.
4. **Nunca `echo` de segredo**, nem em step de debug. O mascaramento do Actions é uma
   rede de proteção, não um controle.
5. **PR de fork usa `pull_request`, nunca `pull_request_target`** — `pull_request_target`
   roda com o token privilegiado no contexto do repositório base e é o vetor clássico
   de exfiltração de segredo por PR malicioso.
6. **Actions fixadas por SHA** (não por tag móvel) para as que tocam em segredos.
7. **Environment secrets com required reviewers** para qualquer segredo de produção,
   quando o deploy existir.
8. **Push protection + secret scanning** ativos no repositório (US-0.7, TASK-0.7.2);
   `gitleaks` roda em todo PR sobre o histórico completo.

### 3.3 Inventário de segredos de CI

| Segredo                              | Existe hoje?     | Escopo                   | Responsável | Observação                                                           |
| ------------------------------------ | ---------------- | ------------------------ | ----------- | -------------------------------------------------------------------- |
| `GITHUB_TOKEN`                       | Sim (automático) | Por job, efêmero         | GitHub      | Não é gerenciado por nós; só restringir `permissions:`               |
| `GITLEAKS_LICENSE`                   | Não              | Repositório              | Henrique    | Só necessário para repositório de **organização**; avaliar na US-0.7 |
| `SEMGREP_APP_TOKEN`                  | Não              | Repositório              | Henrique    | Opcional — o `semgrep --config auto` roda sem token                  |
| `SNYK_TOKEN`                         | Não              | Repositório              | Henrique    | Só se optarmos por Snyk além do `pnpm audit`                         |
| `TURBO_TOKEN` / `TURBO_TEAM`         | Não              | Repositório              | Henrique    | Só se ativarmos Remote Cache do Turborepo                            |
| Credenciais de deploy (VPS/registry) | Não              | Environment `production` | Henrique    | **Sprint 6+**, via OIDC/deploy key de escopo único                   |

> **Pendência operacional:** criar qualquer um destes exige o `gh auth login` do
> usuário ou acesso ao painel do GitHub. Nada disso é escopo da Sprint 0 — a
> configuração do repositório (branch protection, push protection, secrets) entra
> na **US-0.7**.

---

## 4. Inventário e rotação de segredos

Herdado de **Sato §9.3**. Responsável pela execução: **Henrique** (infraestrutura).
Responsável pela auditoria: **Sato**. Toda rotação é registrada em `audit_logs`.

| Segredo                                    | MVP (Docker Secrets)   | Fase B (Vault/AWS SM)           | Cadência                                 |
| ------------------------------------------ | ---------------------- | ------------------------------- | ---------------------------------------- |
| JWT signing key (par RS256)                | Docker secret + `kid`  | Vault PKI / rotação automática  | **Trimestral** (com `kid`, sem downtime) |
| AraraHQ webhook secret                     | Docker secret          | Vault                           | Semestral ou sob suspeita                |
| Stripe / Asaas webhook secrets             | Docker secret          | Vault                           | No painel do provedor; semestral         |
| LLM API keys (OpenAI / Anthropic)          | Docker secret          | Vault                           | Trimestral + imediata sob suspeita       |
| Postgres (`movivo_app`, `movivo_migrator`) | Docker secret          | Vault dynamic secrets           | Trimestral                               |
| Redis password / ACL                       | Docker secret          | Vault                           | Trimestral                               |
| Chave `pgcrypto` (coluna de saúde)         | Docker secret          | Vault/KMS + envelope encryption | **Anual**, com re-encrypt planejado      |
| Segredos de CI (quando existirem)          | GitHub Actions Secrets | OIDC (sem segredo estático)     | Trimestral enquanto forem estáticos      |

### 4.1 Runbook de rotação (MVP)

1. Gerar o novo valor (`bash scripts/gen-local-secrets.sh --force` em dev; `openssl rand` em produção).
2. Atualizar o arquivo do Docker Secret.
3. `rolling restart` dos serviços que o consomem (`docker compose up -d --force-recreate <serviço>`).
4. Invalidar/revogar o valor antigo no provedor (quando houver provedor externo).
5. Registrar a rotação em `audit_logs` (quem, qual segredo, quando — nunca o valor).
6. Para a JWT signing key: publicar a nova com novo `kid` e aceitar `N` e `N-1`
   durante a janela de rotação (Sato §9.1) — rotação sem invalidar sessões ativas.

> ⚠️ Rotacionar senha de Postgres **não** altera a senha de uma role já criada.
> Em dev, rode `--force` e recrie os volumes. Em produção, execute o
> `ALTER ROLE ... PASSWORD` **antes** do restart, dentro da janela de manutenção.

---

## 5. Em caso de vazamento

1. **Rotacione primeiro, investigue depois.** Trocar o segredo tem custo baixo;
   deixá-lo válido por mais uma hora, não.
2. Revogue o valor antigo no provedor.
3. Se o segredo foi commitado: rotacionar **não basta** — o valor permanece no
   histórico do Git e em qualquer fork/clone. Rotacione **e** avalie reescrita de
   histórico (`git filter-repo`) com Sato.
4. Registre o incidente (o que vazou, por quanto tempo, quem teve acesso).
5. Se houver risco de acesso a dado pessoal de usuário, acione **Alexandre (CLO)**:
   a LGPD exige comunicação à ANPD e aos titulares em prazo razoável.

---

## 6. Reportar uma vulnerabilidade

Contato: os fundadores do repositório. **Não abra issue pública** para vulnerabilidade
— relate em canal privado, com detalhes de reprodução, e aguarde confirmação antes
de qualquer divulgação.

# CI/CD e proteção de `main` — Handoff operacional (US-0.7)

**Dono:** Henrique Matsuda (Platform Engineering / SRE) · Sprint 0 · US-0.7
**Fontes:** `sprint/sprint-0-fundacao.md` US-0.7 · `docs/qualidade/quality-gates.md` (Mariana) · `docs/fitness-ia-whatsapp/11-relatorio-sato.md` §12 · `docs/SECURITY.md` §3

O pipeline (`.github/workflows/ci.yml`) é código e já está no repositório. Este
documento cobre o que **não** é código — as configurações do lado do GitHub que
exigem um `gh` autenticado ou acesso de admin ao painel, e por isso **não puderam
ser executadas pelo agente** que construiu a Sprint 0 (o `gh` do ambiente está
instalado mas não autenticado; `gh auth login` é interativo).

> Faça os passos **na ordem**. O passo 2 (branch protection) só funciona depois
> que o CI rodou ao menos uma vez (passo 1), porque o GitHub só "conhece" os
> nomes dos status checks depois da primeira execução.

---

## Visão geral dos status checks

O `ci.yml` produz **6 status checks** independentes, todos obrigatórios para merge:

| Check | O que roda | Bloqueia merge quando |
|---|---|---|
| `quality` | lint, format:check, typecheck, build, testes unit + **cobertura ≥ 80%** | qualquer etapa falha ou cobertura < 80% |
| `integration` | sobe o stack Docker (US-0.2), migra, seed, `test:int` | teste de integração falha / stack não fica healthy |
| `e2e` | Playwright (smoke da home) | E2E falha |
| `secret-scan` | gitleaks no histórico completo | qualquer secret detectado |
| `sast` | semgrep `--config auto` | finding HIGH/ERROR |
| `sca` | `pnpm audit --audit-level=high` | CVE HIGH/CRITICAL |

---

## Passo 1 — Autenticar o `gh` e fazer o CI rodar uma vez

```bash
gh auth login          # GitHub.com → HTTPS → conta com admin em Os-Guri-do-Vibe/movivo
```

Depois, garanta que o workflow executou pelo menos uma vez: abra um PR qualquer
(ou faça um push numa branch) e confirme, em **Actions**, que os 6 jobs
apareceram. Sem isso, o passo 2 não consegue referenciar os checks pelo nome.

---

## Passo 2 — Branch protection em `main`

### Opção A (recomendada) — script idempotente

```bash
DRY_RUN=1 bash scripts/setup-branch-protection.sh   # confere o payload primeiro
bash scripts/setup-branch-protection.sh             # aplica de fato
```

O script exige as 6 checks verdes + 1 review + strict (branch atualizada) + sem
force-push + regras válidas também para admins. Reexecutar converge para o mesmo
estado.

### Opção B — pelo painel web

`https://github.com/Os-Guri-do-Vibe/movivo/settings/branches` → **Add branch
ruleset** (ou *Add rule* no modelo clássico) para o alvo `main`:

1. **Require a pull request before merging** → **Require approvals: 1**.
2. Marque **Dismiss stale pull request approvals when new commits are pushed**.
3. **Require status checks to pass before merging** → marque **Require branches
   to be up to date before merging** (strict) e adicione os 6 checks:
   `quality`, `integration`, `e2e`, `secret-scan`, `sast`, `sca`.
4. **Require conversation resolution before merging**.
5. **Do not allow bypassing the above settings** (equivale ao `enforce_admins`).
6. Em **Rules → Restrict force pushes** (bloquear force-push) e **Restrict
   deletions** (bloquear deleção da branch).
7. Salve.

---

## Passo 3 — Secret scanning + Push protection (server-side)

O job `secret-scan` (gitleaks) roda no CI, mas a **proteção no momento do push**
(impede o commit de chegar ao GitHub) é um recurso do próprio GitHub e precisa
ser ligada no painel:

`Settings → Code security and analysis`:

1. **Secret scanning** → **Enable**.
2. **Push protection** → **Enable**.

> Em repositório privado de organização, esses recursos podem exigir **GitHub
> Advanced Security**. Em repositório público, estão disponíveis gratuitamente.

---

## Passo 4 — Habilitar o Dependabot

O arquivo `.github/dependabot.yml` já está versionado. Ligue o serviço:

`Settings → Code security and analysis`:

1. **Dependabot alerts** → **Enable**.
2. **Dependabot security updates** → **Enable**.
3. **Dependabot version updates** → **Enable** (passa a ler o `dependabot.yml`).

---

## Passo 5 — (Opcional) Secrets de CI

**A Sprint 0 não requer nenhum secret de CI** (`docs/SECURITY.md` §3.1). O pipeline
roda inteiro com o `GITHUB_TOKEN` efêmero. Só adicione algo aqui se, no futuro:

- o repositório virar de **organização** e o gitleaks pedir `GITLEAKS_LICENSE`;
- optarmos por `SEMGREP_APP_TOKEN` (findings gerenciados) ou `SNYK_TOKEN`;
- ligarmos o Remote Cache do Turborepo (`TURBO_TOKEN` / `TURBO_TEAM`).

Adicione em `Settings → Secrets and variables → Actions`, com escopo mínimo.
Deploy (OIDC, sem token de longa duração) é **Sprint 6+**.

---

## Checklist final de aceite da US-0.7

- [ ] `gh auth login` feito por um mantenedor com admin no repo.
- [ ] CI rodou ao menos uma vez (6 checks visíveis em Actions).
- [ ] Branch protection aplicada em `main` (script ou painel).
- [ ] Secret scanning + push protection ligados.
- [ ] Dependabot (alerts + security + version updates) ligado.
- [ ] Demonstração: um PR "ruim" (secret plantado / dep vulnerável / teste
      quebrado / cobertura < 80%) é **bloqueado**; um PR "bom" passa.

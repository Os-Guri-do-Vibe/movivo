<!--
  Template de PR da MOVIVO — Definition of Done do time (US-0.8 / TASK-0.8.5, Mariana).
  Política completa dos gates: docs/qualidade/quality-gates.md.
  Preencha o resumo, marque o checklist e não remova itens — desmarcado significa "não aplicável, e eis por quê".
-->

## O que este PR faz

<!-- 1–3 frases. Uma responsabilidade por PR (regra de commit do CLAUDE.md). -->

## Por que

<!-- Link para a US/TASK da sprint ou o motivo. Ex.: US-0.x / TASK-0.x.y -->

## Como testar

<!-- Passos para revisar/reproduzir localmente. -->

---

## Definition of Done — checklist de merge

### Qualidade (gates ATIVOS)
- [ ] `pnpm run lint` verde (0 warnings).
- [ ] `pnpm run typecheck` verde.
- [ ] `pnpm run build` verde nos workspaces afetados.
- [ ] `pnpm run test` verde (unit + componente).
- [ ] Cobertura **≥ 80%** nos apps tocados (`test:cov` passou — statements/branches/functions/lines).
- [ ] Testes-semente e/ou de integração afetados verdes (`test:int`, `test:e2e` quando aplicável).
- [ ] Teste **novo** cobrindo o comportamento adicionado/corrigido (não só o caminho feliz).

### Segurança (gates de Sato §12.3)
- [ ] Nenhum secret no diff nem no histórico (gitleaks verde). Só `.env.example` versionado.
- [ ] Zero CVE HIGH/CRITICAL sem exceção **documentada e datada** (SCA verde).
- [ ] SAST sem finding HIGH.
- [ ] Segredos consumidos via contrato `*_FILE` (`SECURITY.md` §2) — nada em `environment:`.

### Regras inegociáveis tocadas neste PR (marque as que se aplicam)
- [ ] Runtime fala com Postgres **só via PgBouncer (5433)**, sem prepared statements.
- [ ] `movivo_app` sem `BYPASSRLS` e sem ownership de tabela.
- [ ] Redis em versão patcheada (CVE-2025-49844), sem exposição pública.
- [ ] Nenhum dado real de pessoa em seed/fixture/teste — apenas sintético.
- [ ] PII (telefone etc.) nunca em log claro (redaction aplicada).
- [ ] Copy/prompt/UI sem "diagnóstico/tratamento/cura/resultado garantido"; presença CREF visível.

### Processo
- [ ] Commit segue Conventional Commits (`tipo(escopo): descrição` em PT-BR), sem coautor de IA.
- [ ] PR de responsabilidade única.
- [ ] ≥ 1 review aprovado.

---

### Gates RESERVADOS — este PR encosta em algum?
<!-- Marque se o PR introduz código de um gate que ainda estava reservado (ver quality-gates.md).
     Se sim, o gate correspondente passa a valer a partir deste PR. -->
- [ ] Motor Determinístico (exige **100%** de cobertura).
- [ ] Isolamento multi-tenant (Redis/Postgres) — teste de zero vazamento.
- [ ] Compliance CREF pós-geração / red-team de IA.
- [ ] Webhook (HMAC + replay + idempotência) / DLQ.
- [ ] Cron de check-in em timezone America/Sao_Paulo.
- [ ] Nenhum dos acima.

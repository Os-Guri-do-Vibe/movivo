# Revisão de segurança consolidada — Sprint 1 (Gabriel Sato)

**Data:** 2026-07-25
**Escopo:** US-1.1 a US-1.7 (fundação de segurança, CONSENT, ANAMNESIS, AUTH, BullMQ), validado sob US-1.8.
**Base:** código real na branch `feat/sprint-1-us-1.8-qa` + testes de integração verdes contra o stack Docker.
**Referência:** `docs/fitness-ia-whatsapp/11-relatorio-sato.md` §4 (RLS), §7.3 (cifra), §8 (token/IDOR/pentest), §9 (auth).

## Veredito global

**APROVADO.** Nenhum achado HIGH em aberto. Os quatro pilares de segurança de dado sensível
desta sprint (RLS `FORCE`, cifra `pgcrypto`, token/IDOR, auth JWT) estão implementados conforme a
especificação do relatório de Fase 4 e provados por teste automatizado. As ressalvas abaixo são de
severidade LOW/INFO, com dono e sprint de destino explícitos.

---

## 1. RLS (§4) — **OK**

- `movivo_app` é `NOBYPASSRLS`, não-`SUPERUSER` e não-dona das tabelas — provado por
  `security-foundation.int-spec.ts` (asserts contra `pg_roles`/`pg_tables`; qualquer regressão
  reprova o pipeline).
- `TenantDatabase` emite o contexto por transação via `set_config(..., is_local := true)` (equivalente
  parametrizável de `SET LOCAL`), nunca `SET`/`SET SESSION` — correto sob PgBouncer transaction mode.
  O `userId`/`role` vai como bind, sem interpolação (sem injeção pelo contexto).
- `FORCE ROW LEVEL SECURITY` em `users`, `consents`, `anamnesis_sessions`, `auth_sessions`; fail-closed
  com `nullif(current_setting(...),'')` (o `''` residual do pooler vira NULL → nega). Preservado — não
  desfiz.
- Fase anônima escopada por sessão (`app.current_anamnesis_session_id`) resolve o achado 1: escopado à
  sessão A, a linha órfã de B não é lida nem alterada (provado em `anamnesis.int-spec.ts`).

## 2. Cifra pgcrypto (§7.3) — **OK**

- `HealthCipherService` cifra `data_block_2` com `pgp_sym_encrypt`; chave vinda de `PGCRYPTO_KEY_FILE`
  (secret), nunca hardcoded nem persistida, trafega só como bind (não loga).
- Round-trip provado; `SELECT` bruto retorna `bytea` sem o plaintext; chave errada não decifra
  (`security-foundation.int-spec.ts`). O pentest confirma que o ciphertext não contém `joelho`/`parq`.
- Ressalva LOW (aceita, adiada): re-encrypt de rotação anual da chave é runbook manual (Fase B) —
  documentado no próprio serviço. **Dono:** Henrique (DevOps) na Fase B.

## 3. Token / IDOR (§8) — **OK**

- Token = `randomBytes(32).hex` (256 bits), TTL 72h, no path param (nunca query), `Referrer-Policy:
  no-referrer` em todas as respostas; token redigido do log.
- Handlers **nunca** aceitam `user_id`/`sessionId` do cliente — sempre resolvem por token; IDOR
  provado (token A ≠ sessão B). Expiração descarta `data_block_2` (minimização).
- **Pentest §8.2 executado — ver tabela abaixo.** Nenhum achado HIGH.

## 4. Auth JWT (§9) — **OK**

- `algorithms: ['RS256']` explícito em `jwt.strategy.ts` e `token.service.ts` — rejeita `alg:none`/`HS256`.
  `kid` no header para rotação sem downtime.
- Refresh rotation com hash no banco + denylist `jti` em Redis no logout + detecção de reuse que
  invalida a família (log `auth_refresh_reuse` → 401). RBAC barra role insuficiente; rate limit de login
  (429). Tudo exercido em `auth.int-spec.ts` (verde).

---

## Checklist de pentest da anamnese (§8.2 — TASK-1.8.4)

Cada item provado por `apps/api/test/anamnesis-pentest.int-spec.ts` (5 testes verdes) salvo indicação.

| # | Classe de ataque | Severidade | Status | Evidência |
|---|---|---|---|---|
| 1 | SQLi em campos de texto (bloco 1) e no bloco cifrado (bloco 2) | **Neutralizado** (INFO) | OK | Payload `'; DROP TABLE users; --` vira dado literal; tabelas intactas. Drizzle parametrizado + `pgp_sym_encrypt` com bind. |
| 2 | Injeção de estrutura JSONB (blocos 1/3) | **Neutralizado** (INFO) | OK | `JSON.stringify(...)::jsonb` parametrizado: string não forja chave (`isAdmin`/`role` ausentes). |
| 3 | XSS armazenado (campo livre → dashboard CREF) | LOW (baseline) | Aceito/adiado | Dado persistido **cru** por design (encoding é de saída). **Requisito registrado:** dashboard CREF (Sprint 5) DEVE fazer output-encoding (React escapa por padrão) + CSP sem `unsafe-inline`. **Dono:** Felipe (Sprint 5). |
| 4 | XSS refletido em mensagens de erro | **Neutralizado** (INFO) | OK | Erro de bloco inválido não ecoa HTML do input; respostas são JSON com `X-Content-Type-Options: nosniff`. |
| 5 | Injeção NoSQL/JSONB (objetos aninhados) | **Neutralizado** (INFO) | OK | Coberto por #2 (mesmo caminho de serialização parametrizada). |
| 6 | Prompt injection via anamnese (campo de lesão) | LOW (baseline) | Aceito/adiado | Texto malicioso só persistido (cifrado), nunca interpretado: submit não chama LLM, gate PAR-Q é determinístico. **Requisito:** PII scrubber + delimitação estrutural no prompt. **Dono:** Victor (Sprint 2, §10). |

Itens de autorização/rate/gate do §8.2 (enumeração de token, expiração, IDOR, bloco 2 sem
consentimento, gate PAR-Q bloqueante) já estavam provados em `anamnesis.int-spec.ts`/`consent.int-spec.ts`
(US-1.3) — reconfirmados verdes nesta rodada.

## Achados por severidade

- **HIGH:** nenhum.
- **MEDIUM:** nenhum.
- **LOW (aceitos, com dono):** XSS armazenado (output-encoding no dashboard — Felipe/Sprint 5);
  prompt injection (scrubber/Motor — Victor/Sprint 2); re-encrypt de rotação de chave (runbook — Henrique/Fase B).

## Gates de validação

- `lint` / `typecheck` / `build` / `format:check`: 0 erros.
- `test:cov` (unit): 94.3% statements, 95.98% lines — acima do gate de 80%.
- `test:int`: 9 arquivos / 49 testes verdes (inclui os 5 de pentest e os de isolamento da Mariana).
- Isolamento multi-tenant promovido a **bloqueante** no `docs/qualidade/quality-gates.md` (Mariana).

## Conclusão

US-1.8 (parte de Sato) concluída. Recomendo **fechar a Sprint 1**: a superfície não-autenticada que
coleta dado de saúde está com injeção neutralizada e defesas em profundidade (RLS + cifra + token +
auth) provadas por teste. Os itens LOW são de escopo de sprints futuras e têm dono explícito.

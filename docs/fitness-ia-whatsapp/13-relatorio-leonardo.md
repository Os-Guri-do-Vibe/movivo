# Relatório — Leonardo Ishikawa (Backend Engineering)

**Data:** 03/08/2026  
**Ideia analisada:** MOVIVO — orientação de treino conversacional via WhatsApp, supervisionada por profissional CREF  
**Pasta do projeto:** `docs/fitness-ia-whatsapp/`  
**Status do pipeline:** Fase 5 — backend da Sprint 5 implementado e aprovado nos gates locais; integração real aguarda Docker Desktop

## 1. Resumo Executivo

A Sprint 5 foi concluída no backend com check-in semanal, reengajamento, dashboard CREF, edição e assinatura humana de protocolos, liberação humana de PAR-Q, auditoria imutável, consentimento revogável e atualização da fila em tempo real por SSE. O acesso operacional a saúde é exclusivo de `PROFESSIONAL` com CREF ativo, atribuição explícita e consentimento vigente; `ADMIN` não acessa o dashboard de saúde.

O gate local final aprovou **86 arquivos e 587 testes**. A cobertura global ficou em **91,92% statements, 83,82% branches, 89,40% funções e 93,27% linhas**. TypeScript e ESLint também passaram. O daemon do Docker Desktop não estava disponível, portanto a suíte com PostgreSQL/Redis real não pôde ser executada nesta estação.

## 2. Contexto Técnico

A implementação respeita o PRD de Lucas, os fluxos de Sofia, a arquitetura de Rafael, os controles de Sato, as exigências jurídicas de Alexandre e os contratos de IA de Victor. Foram mantidos NestJS 11, Drizzle ORM, PostgreSQL, Redis, BullMQ, Zod e a API `/api/v1`, sem nova dependência.

Regras preservadas:

- dado de saúde cifrado e isolado por RLS;
- profissional CREF como decisor e supervisor;
- nenhuma alteração automática de protocolo pelo check-in ou LLM;
- liberação PAR-Q somente como `RELEASED`, sem ressalva livre não estruturada;
- mensagens sem diagnóstico, tratamento, cura, garantia ou promessa operacional de duas horas;
- consentimento de saúde específico, versionado e revogável pela frase exata no WhatsApp.

## 3. Solução Recomendada

A solução implementada combina cinco capacidades:

1. Check-in semanal determinístico, com sequência protegida contra replay e resposta fora de ordem.
2. Detecção conservadora de sinais de dor/desconforto forte, persistência cifrada e handoff SAFETY atômico.
3. Dashboard exclusivo do profissional atribuído, com fila, detalhes, mutações humanas e métricas operacionais.
4. Consentimento `consent-health-2026-08-v2`, revogação executável, bloqueio de jobs e retirada imediata do titular da operação profissional.
5. SSE autenticado para invalidação da fila, mantendo polling como fallback.

A promoção deve ocorrer somente depois de aplicar as migrações em um banco de staging e executar a suíte de integração real.

## 4. Arquitetura da Implementação

O scheduler BullMQ consulta em lote protocolos e assinaturas elegíveis com consentimento vigente, calcula a semana e distribui o envio na janela operacional. Jobs e registros usam identificadores estáveis para recuperação após retry ou failover.

O inbound WhatsApp valida HMAC, timestamp, nonce e titular. Quick replies de check-in seguem `fatigue → workouts → adjustment` com compare-and-set por `current_question`; respostas atrasadas ou repetidas não avançam o estado. O conteúdo efêmero usado no roteamento entre WhatsApp e Check-in fica no Redis por 60 segundos, e o evento de domínio transporta apenas referência opaca.

O relato de dor e o alerta SAFETY são persistidos na mesma transação. Somente depois do commit o outbound é enfileirado. Isso elimina a janela em que uma falha poderia gravar o relato sem criar o handoff.

O dashboard REST e SSE usa `JwtAuthGuard`, `RolesGuard` e defesa adicional no service. O stream SSE envia apenas `{ "invalidate": true }`, heartbeat vazio, encerra em cinco minutos para revalidar a sessão e libera o listener em disconnect/unsubscribe.

## 5. Estrutura de Código

Principais entregas:

- `modules/checkin/checkin.service.ts` e `checkin.scheduler.ts`: estado, cifra, segurança, agenda e nudge;
- `modules/checkin/checkin-inbound.handler.ts`: fronteira por evento, sem import de domínio WhatsApp;
- `modules/admin/dashboard.controller.ts` e `dashboard.service.ts`: REST, SSE, fila, detalhes, mutações e métricas;
- `modules/admin/audit.service.ts`: eventos tipados na trilha imutável;
- `core/event-bus/dashboard-queue-events.service.ts`: stream opaco com heartbeat, expiração e cleanup;
- `core/database/health-consent.service.ts`: gate transversal e revogação estreita;
- `core/database/security-policies.ts`: RLS, funções `SECURITY DEFINER`, grants mínimos e hash chain;
- `modules/protocol/protocol.repository.ts`: assinatura automática vinculada a CREF real atribuído;
- `modules/jobs/whatsapp-outbound.contract.ts`: contrato outbound fora do domínio WhatsApp;
- migrações `0011` a `0016`: Sprint 5, unicidade de atribuição, FK do signer, saneamento legado e ciclos de consentimento.

Contratos do dashboard:

- `GET /api/v1/professional/dashboard/queue`;
- `GET /api/v1/professional/dashboard/queue/events` — SSE;
- `GET /api/v1/professional/dashboard/queue/:kind/:id`;
- `PATCH /api/v1/professional/dashboard/protocols/:id`;
- `POST /api/v1/professional/dashboard/protocols/:id/sign`;
- `POST /api/v1/professional/dashboard/parq/:id/release`;
- `POST /api/v1/professional/dashboard/handoffs/:id/resolve`;
- `GET /api/v1/professional/dashboard/operations`.

## 6. Banco de Dados e Persistência

Foram adicionadas `professional_assignments`, `audit_logs` e `reengagement_nudges`. Check-ins persistem respostas somente em `responses_cipher`; handoffs têm origem durável e única.

As funções privilegiadas são estreitas:

- `assign_unique_active_professional` atribui ou reativa o único CREF elegível;
- `assigned_active_professional` resolve o signer real e falha sem consentimento/atribuição;
- `release_parq_clearance` aceita somente profissional CREF atribuído e estado `LIBERADO`;
- `record_session_consent` valida sessão, finalidade, versão e origem;
- `link_session_consents_to_user` cria ciclo imutável sob advisory lock;
- `revoke_health_data_consent` revoga consentimentos, desativa atribuições e audita no mesmo commit.

A role de runtime perdeu `INSERT`, `UPDATE` e `DELETE` diretos em `consents`; gravação, vínculo e revogação passam exclusivamente pelas funções autorizadas.

A migração `0015` valida a semântica completa do signer antes de criar a FK: identidade existente, papel `PROFESSIONAL`, `cref_active=true` e atribuição ativa ao titular. Um signer inválido é remapeado para o CREF válido atribuído; sem vínculo válido, a assinatura é limpa e o protocolo volta para `PENDING_SIGNATURE/PENDING_REVIEW` com revisão humana obrigatória. A `0016` adiciona ciclos de consentimento para preservar revogação e novo aceite como provas distintas.

## 7. Estratégia de Segurança

- Dashboard de saúde exclusivo de `PROFESSIONAL`; `ADMIN` é recusado no controller/service.
- RLS profissional exige atribuição ativa e consentimento `HEALTH_DATA` vigente.
- `consents` não possui policy profissional, evitando acesso ao histórico segregado e autorreferência recursiva.
- O helper usado em policies retorna `false` para contexto não autorizado; funções mutadoras continuam falhando com exceção.
- Revogação pelo WhatsApp aceita somente a frase exata `REVOGAR CONSENTIMENTO DE SAÚDE`, preserva o histórico e interrompe novos tratamentos.
- Workers de IA, protocolo, outbound de saúde e scheduler revalidam consentimento para neutralizar jobs em corrida.
- `CONSENT_STATUS` continua permitido após revogação para confirmar a cessação.
- Assinatura e edição usam `SELECT ... FOR UPDATE`; estado e validação são rechecados dentro da transação.
- Retry já assinado/liberado não recria versão, auditoria, entrega ou job de geração.
- Motivos e notas livres entram na auditoria somente como hash, sem texto de saúde.
- Logs da AraraHQ não carregam telefone; SSE não carrega UUID, categoria, horário, PII ou PHI.
- Seed de desenvolvimento usa identidade real na tabela `users`, CREF fictício e segredo externo; nenhum signer sintético permanece no fluxo de protocolo.

Auditoria de dependências em 03/08/2026:

- NestJS `11.1.28`, acima da correção `11.1.18` para GHSA-36xv-jgw5-4q75;
- Zod `4.4.3`, fora dos intervalos reportados em CVE-2023-4316 e CVE-2026-6991;
- BullMQ `5.81.2` e Drizzle ORM `0.45.2`, sem achado no `pnpm audit --prod` do lockfile;
- Auth.js não é dependência do backend atual;
- uma vulnerabilidade moderada ficou fora do backend, em `apps/web > next > postcss <=8.5.22` (GHSA-fxqj-rqcc-2cmp), encaminhada ao frontend.

Limitação: as páginas filtradas do GitHub Advisory Database para BullMQ e `@auth/core` não carregaram de forma consistente. O CI deve manter Dependabot e auditoria recorrente.

## 8. Estratégia de Observabilidade

Logs estruturados registram scheduler, envio, resposta, SAFETY, reengajamento, revogação e descarte de job sem consentimento, sempre sem conteúdo de saúde. A auditoria registra cada titular acessado no dashboard de operações uma única vez por requisição.

O dashboard calcula funil, primeiro treino, SLA médio de protocolo e p95 do Coach. O SSE só invalida o cache do cliente; a nova leitura REST continua sendo a fonte autorizada e auditável dos dados.

O serviço expõe contagem interna de conexões SSE para teste/lifecycle. A instrumentação central de métricas e alertas OpenTelemetry permanece para a Fase 6.

## 9. Estratégia de Testes

Cobertura funcional adicionada:

- check-in nominal, CAS, replay, resposta fora de ordem, consentimento revogado e nudge;
- sinais positivos `dor no quadril` e `desconforto forte no tornozelo`;
- negativos `sem dor`, `meu joelho esta otimo` e `mobilidade articular`;
- transação única para `painReport + SAFETY` e ausência de outbound em rollback;
- assinatura/edição com `FOR UPDATE`, CREF, validação e retries sem efeito externo duplicado;
- PAR-Q somente `RELEASED` e sem reagendamento no replay;
- SSE com RBAC, headers, payload opaco, heartbeat, expiração e teardown;
- revogação, bloqueio profissional, acesso segregado SYSTEM/ADMIN e ausência de recursão em `consents`;
- revogar → novo ciclo de aceite → reatribuir CREF;
- migração de signer órfão, papel inválido e CREF inativo antes da FK.

Gates finais:

- `pnpm --filter @movivo/api typecheck`: aprovado;
- `pnpm lint:api`: aprovado;
- `pnpm --filter @movivo/api test`: **86 arquivos, 587 testes aprovados**;
- `pnpm --filter @movivo/api test:cov`: **91,92 / 83,82 / 89,40 / 93,27%**;
- shared typecheck/lint/test: aprovados, **3 arquivos e 11 testes**;
- `git diff --check`: aprovado;
- integração PostgreSQL/Redis: não executada porque o Docker CLI não encontrou `dockerDesktopLinuxEngine`; a tentativa anterior atingiu timeout/`ECONNREFUSED` na porta 15432.

## 10. Estratégia de Performance

O scheduler faz scan em lote com índices de status, usuário e consentimento. Unicidades duráveis evitam check-in, handoff, nudge e atribuição ativa duplicados. Jobs BullMQ permanecem idempotentes porque a garantia está no banco e na chave de negócio, não na suposição de entrega única.

O SSE usa payload mínimo e polling de fallback. Cada conexão encerra em cinco minutos; heartbeat ocorre a cada 25 segundos. A implementação in-process atende o MVP single-replica. Antes de escala horizontal, a origem dos eventos deve migrar para Redis Pub/Sub ou outro barramento compartilhado sem alterar o contrato SSE.

Benchmarks com volume real, Redis AOF e `EXPLAIN ANALYZE` permanecem obrigatórios antes da produção.

## 11. Impacto na LGPD e Privacidade

- Consentimento v1 histórico foi preservado sem edição; v2 contém a frase de revogação executável.
- Revogação carimba todas as provas HEALTH_DATA ativas, desativa atribuições e gera `HEALTH_CONSENT_REVOKED` na hash chain, sem PII/PHI no payload.
- Novo aceite usa ciclo incremental, preservando a prova revogada anterior.
- Ausência de consentimento bloqueia inbound, scheduler, geração, resposta de IA, outbound de saúde e dashboard profissional.
- Histórico revogado permanece acessível somente ao titular e aos contextos segregados SYSTEM/ADMIN para obrigações legais/compliance.
- Leitura de saúde no dashboard é auditada; replays removem identificadores.
- Dados e relatos permanecem cifrados em repouso; textos livres não entram na auditoria.

Retenção, portabilidade, anonimização e eliminação devem incluir as novas tabelas antes da produção.

## 12. Trade-offs

- **SSE in-process:** menor implementação sem dependência nova; exige barramento compartilhado ao escalar para múltiplas réplicas.
- **Stream global opaco:** qualquer profissional autenticado recebe apenas uma invalidação sem metadados; a autorização real ocorre na nova leitura REST/RLS.
- **Detecção lexical:** determinística e conservadora; o responsável técnico deve ratificar vocabulário e limiares antes da produção.
- **Um CREF ativo no bootstrap:** adequado ao MVP e fail-closed; multi-RT exigirá roteamento explícito.
- **Hash chain no PostgreSQL:** evidência forte no MVP; WORM externo pode complementar quando o risco justificar.
- **Ciclos de consentimento:** adicionam uma coluna e lock estreito, em troca de preservar a sequência revogação/reaceite sem sobrescrever prova.

## 13. Checklist de Implementação

- [x] Scheduler semanal no fuso de São Paulo e somente com consentimento vigente.
- [x] Três perguntas sequenciais, CAS e resposta cifrada.
- [x] SAFETY atômico e zero alteração automática de protocolo.
- [x] Nudge único após inatividade.
- [x] Dashboard PROFESSIONAL-only com RLS por atribuição/consentimento.
- [x] SSE autenticado, opaco, anti-cache, heartbeat, expiração e cleanup.
- [x] Edição e assinatura serializadas por row lock.
- [x] Signer real com FK, CREF ativo e atribuição explícita.
- [x] PAR-Q somente `RELEASED`, exclusivamente humano.
- [x] Auditoria append-only com SHA-256 e leitura por titular.
- [x] Consentimento v2, revogação WhatsApp, bloqueio de jobs e ciclos de reaceite.
- [x] Migração fail-closed de signers legados.
- [x] Typecheck, lint, unitários, shared, cobertura e diff-check aprovados.
- [ ] Executar integração com Docker/PostgreSQL/Redis disponíveis.
- [ ] Executar benchmark e `EXPLAIN ANALYZE` com volume representativo.

## 14. Próximos Passos

1. Iniciar Docker Desktop e executar `pnpm --filter @movivo/api test:int` completo.
2. Aplicar `0011`–`0016` em cópia anonimizada de staging e revisar o resultado da data migration `0015`.
3. Validar concorrência sign/edit e revogação/reaceite contra PostgreSQL real.
4. Executar E2E frontend/BFF/SSE/API com expiração e reconexão do stream.
5. Validar vocabulário SAFETY com o responsável técnico CREF.
6. Configurar métricas, alertas e barramento compartilhado na Fase 6.
7. Incluir novas tabelas nos jobs de retenção, portabilidade e anonimização.

## 15. Fontes Consultadas

- NestJS — Authentication: https://docs.nestjs.com/security/authentication
- NestJS — Authorization: https://docs.nestjs.com/security/authorization
- NestJS — Server-Sent Events: https://docs.nestjs.com/techniques/server-sent-events
- BullMQ — Job Schedulers: https://docs.bullmq.io/guide/job-schedulers
- BullMQ — Repeat strategies e timezone: https://docs.bullmq.io/guide/job-schedulers/repeat-strategies
- BullMQ — Produção e persistência Redis: https://docs.bullmq.io/guide/going-to-production
- BullMQ — Métricas: https://docs.bullmq.io/guide/metrics
- BullMQ — Changelog: https://docs.bullmq.io/changelog
- Drizzle ORM — Row-Level Security: https://orm.drizzle.team/docs/rls
- Drizzle ORM — Migrações: https://orm.drizzle.team/docs/migrations
- Drizzle ORM — Releases: https://github.com/drizzle-team/drizzle-orm/releases
- PostgreSQL — Row Security Policies: https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- PostgreSQL — Explicit Locking: https://www.postgresql.org/docs/current/explicit-locking.html
- PostgreSQL — Trigger Behavior: https://www.postgresql.org/docs/current/trigger-definition.html
- PostgreSQL — pgcrypto: https://www.postgresql.org/docs/current/pgcrypto.html
- Zod — documentação: https://zod.dev/
- Zod — changelog v4: https://zod.dev/v4/changelog
- Auth.js — proteção de recursos: https://authjs.dev/getting-started/session-management/protecting
- GitHub Advisory — NestJS GHSA-36xv-jgw5-4q75: https://github.com/advisories/GHSA-36xv-jgw5-4q75
- GitHub Advisory — NestJS GHSA-4jpv-8r57-pv7j: https://github.com/advisories/GHSA-4jpv-8r57-pv7j
- NVD — Zod CVE-2023-4316: https://nvd.nist.gov/vuln/detail/CVE-2023-4316
- NVD — Zod CVE-2026-6991: https://nvd.nist.gov/vuln/detail/CVE-2026-6991
- GitHub Advisory — PostCSS GHSA-fxqj-rqcc-2cmp: https://github.com/advisories/GHSA-fxqj-rqcc-2cmp
- GitHub — Advisory Database: https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/browsing-security-advisories-in-the-github-advisory-database

# Sprint 5 — Check-in Semanal e Dashboard de Supervisão CREF (MOVIVO)

**Autor:** Lucas Monteiro (Senior Product Manager / Product Owner — agente #08)
**Data:** 2026-08-01
**Ideia:** MOVIVO — AI Coach de treino no WhatsApp (`docs/fitness-ia-whatsapp/`)
**Fase do pipeline:** Fase 5 — Desenvolvimento (Sprint 5)
**Duração alvo:** 2 semanas (10 dias úteis) · 3 devs co-fundadores (Leonardo, Felipe, Henrique) + QA (Mariana), com revisão de segurança de Sato e validação clínico-jurídica de Alexandre / RT CREF (Victor entra só se o ajuste automático via IA for antecipado da Fase 2 — fora do MVP)
**Documentos-fonte obrigatórios:** `docs/arquitetura/ARQUITETURA.md` (§6 filas, §8 janela de check-in / RLS, §10 roadmap, §12 regras inegociáveis) · `docs/fitness-ia-whatsapp/08-relatorio-lucas.md` (**Épico 6 — Check-in Semanal e Retenção**, **Épico 7 — Operações e Observabilidade**, North Star, aha moment, feedback loop) · `docs/fitness-ia-whatsapp/09-relatorio-sofia.md` (§11.5 check-in com 3 quick replies, loop visível, momento de vitória, §10 Dashboard CREF, §13 termos proibidos) · `docs/fitness-ia-whatsapp/06-relatorio-alexandre.md` (supervisão CREF, gate PAR-Q, liberação humana obrigatória, assinatura eletrônica, LGPD dado de saúde) · `docs/fitness-ia-whatsapp/12-relatorio-victor.md` (`ValidationService` reusado na edição do protocolo pelo profissional no painel; geração+validação como base do ajuste automático da Fase 2) · `docs/fitness-ia-whatsapp/11-relatorio-sato.md` (RLS/RBAC do painel, replays anonimizados, isolamento) · `docs/fitness-ia-whatsapp/10-relatorio-rafael.md` (Dashboard Next.js + Socket.io, assinatura login+timestamp+hash, versionamento de protocolo)

---

## Como ler este documento

Hierarquia: **Épicos → User Stories (US-5.x) → Tasks (TASK-5.x.y)**.

- Cada **User Story** declara: agentes participantes e ordem, dependências (depende de / habilita), jornada (o que se constrói e por quê), objetivo, resultado esperado, tasks e **Definição de Pronto (DoD)**.
- Cada **Task** declara: agente executor, instruções acionáveis e critério de conclusão objetivo.
- Uma User Story só é **ENTREGUE** quando **todas** as suas tasks estiverem finalizadas **E validadas** conforme o DoD (code review, teste automatizado verde, quality gate, revisão de segurança de Sato, validação clínico-jurídica de Alexandre / RT CREF).
- Esta é a **quinta e última sprint do MVP**. As Sprints 1-4 entregaram a porta de entrada (anamnese), o núcleo de valor (protocolo), o diálogo (AI Coach MOVI) e a monetização (conversão + pagamento). **A Sprint 5 fecha o ciclo de retenção e a supervisão humana** — as duas peças que faltam para o produto ser "coaching real" e legalmente defensável.

> **Decisão de escopo: dois épicos juntos (6 + 7), e por que são inseparáveis.** O fundador confirmou o par. A razão é uma dependência de fluxo, não uma coincidência de calendário: **o check-in coleta feedback e sinaliza o profissional** (pedido explícito de ajuste, baixa aderência recorrente e — como exceção de segurança — dor anormal → handoff `SAFETY`), e é o **profissional CREF quem decide a mudança concreta no treino, via Dashboard** (no MVP não há ajuste automático — decisão do fundador abaixo). Essa sinalização **precisa de um humano do outro lado**, e até agora **não existe humano nenhum no loop**: a Sprint 2 acumulou protocolos `PENDING_REVIEW`, a Sprint 3 acumulou `handoff_alerts` (níveis `ALERT`/`SAFETY`) e sessões `BLOCKED_PENDING_CLEARANCE` (PAR-Q de risco) — **três sprints de dívida de supervisão**, com um segmento de usuários (PAR-Q de risco) **permanentemente bloqueado** porque nunca houve tela para o profissional CREF liberá-los. O **Dashboard CREF é onde essa supervisão acumulada finalmente acontece** — e é pré-condição de compliance (a defensabilidade jurídica do produto perante o CREF, herdada de Clóvis/Alexandre). Construir o check-in **sem** o dashboard deixaria a sinalização sem destino e aumentaria a dívida; construir o dashboard **sem** o check-in deixaria a retenção — a North Star — para depois. Por isso, juntos: o check-in **alimenta** a fila do painel (pela sinalização e pela dívida acumulada), não por auto-ajuste.

> **Decisões do fundador (2026-08-01) — valem sobre qualquer texto em contrário abaixo:**
>
> 1. **Cifrar `checkins.responses` já nesta sprint** — a resposta de dor/desconforto é dado de saúde (Art. 11); reusa a cifra `pgcrypto` da anamnese (US-1.1). Deixa de ser dívida pré-lançamento (entra na US-5.1).
> 2. **SEM ajuste automático de protocolo no MVP.** O check-in **coleta o feedback, mostra o loop de reconhecimento** ("recebi seu retorno 👍") e **registra** as respostas; **não** gera nova versão de protocolo automaticamente. A mudança concreta no treino, quando fizer sentido, vem do **profissional CREF via Dashboard** (US-5.5, edição validada) ou fica para Fase 2. A US-5.2 é reescrita nesse sentido (coleta + loop + roteamento ao painel), **sem** o pipeline gera-e-valida de ajuste. **Exceção de segurança inalterada:** relato de **dor anormal/articular → `handoff_alerts` (SAFETY)** + orientação de parar/procurar avaliação (nunca ajuste de carga).
> 3. **Assinatura = login + timestamp + hash** do **profissional único (Leonardo / RT CREF)** — não ICP-Brasil no MVP. Como há **um só profissional**, a auth do painel (US-5.4) pode ser de conta única (RBAC mínimo), sem gestão de múltiplos profissionais.
> 4. **Check-in só para assinantes (`ACTIVE`)** — o trial de 7 dias expira antes do 1º check-in semanal (já era o previsto).
> 5. **Reengajamento em 2 semanas** de inatividade (corte inicial; revisar com dados).

### Base já entregue pelas Sprints 0-4 (não reconstruir — consumir)

- **Geração por IA guiada + `ValidationService` (Sprint 2):** **no MVP o check-in NÃO re-gera protocolo** (decisão do fundador). O `ValidationService` continua sendo reusado nesta sprint na **edição manual do protocolo pelo profissional** (US-5.5) — nem o humano aplica treino que o validador reprova. A geração+validação também continua pronta para o **ajuste automático da Fase 2** (pluga na US-5.2 quando o RT ratificar o mapa feedback→ajuste). **Não se reimplementa** a geração nem o validador.
- **Tabela `checkins` já modelada (Sprint 0/1):** `weekNumber`, `responses` (JSONB — aderência/esforço/**dor**, dado sensível Art. 11, **cifrado nesta sprint**, US-5.1), `adjustments`/`newProtocolId` (ficam nulos no MVP — só usados quando o ajuste automático entrar na Fase 2), e o **`UNIQUE(user_id, protocol_id, week_number)` que torna o disparo semanal idempotente** (failover do scheduler não gera dois check-ins da mesma semana). A Sprint 5 preenche a lógica — não remodela.
- **Tabela `handoff_alerts` já modelada (US-3.6):** `level` (`ALERT` = revisão assíncrona sem promessa de retorno; `SAFETY` = red flag clínica, prioritário), `status` (`OPEN`…), `reason`, `conversationId`. Os docstrings já dizem que **"a UI, a notificação e a resolução humana são a Sprint 5, que lê esta tabela"** — é exatamente esta sprint.
- **`protocols` com `approval_status`/`human_review_required` e assinatura da metodologia do RT (US-2.4):** protocolos sem risco nascem `AUTO_APPROVED`; com risco → `PENDING_REVIEW`/`BLOCKED_PENDING_CLEARANCE`. A Sprint 5 constrói a **assinatura/edição/liberação per-usuário** que a Sprint 2 deixou explicitamente para cá.
- **Fila `checkin-weekly` já registrada (US-1.7):** `attempts: 3`, `backoffMs: [5s,15s,45s]`, `concurrency: 10`. A Sprint 5 preenche o `CheckinWeeklyWorker` — não reconstrói a fila.
- **Outbound WhatsApp + quick replies (US-2.5 / Sprint 3):** o check-in usa a fila `whatsapp-outbound` (bolhas, persona MOVI) e os **quick reply buttons** (máx 3, Sofia §11.5) já em uso na conversa.
- **AI Coach / contexto / intent (Sprint 3):** a intenção `CHECKIN_ANTECIPADO` já é **detectada** — a Sprint 5 liga o fluxo de coleta/reconhecimento que ela dispara (sem ajuste automático); o handoff por dor anormal (guardrail de entrada) já grava `handoff_alerts` — a Sprint 5 dá a interface humana.
- **Assinatura/estado da assinatura (Sprint 4):** o check-in semanal é para **pagantes** (`ACTIVE`) — a North Star é "treinos concluídos por usuário **pago**". O gate de assinatura já existe.
- **AuthModule JWT RS256 + RBAC `USER`/`PROFESSIONAL`/`ADMIN` (Sprint 1):** o Dashboard CREF é **autenticado** (login do profissional com `password_hash` Argon2id — os únicos papéis que fazem login), ao contrário das telas de usuário do MVP (não-autenticadas por token, ADR-006). A Sprint 5 constrói a autenticação de sessão do painel (Auth.js/Next.js sobre o RBAC existente).
- **Isolamento por titular (RLS `FORCE ROW LEVEL SECURITY` + `SET LOCAL`):** estende-se ao check-in e às leituras do painel — a policy do `PROFESSIONAL`/`ADMIN` difere da do titular via `app.current_role` (Sato §4.3).

### Regras inegociáveis que valem nesta sprint (de `ARQUITETURA.md` §12, `06-alexandre`, `12-victor`, `11-sato`)

1. **No MVP o check-in NÃO ajusta o protocolo automaticamente** (decisão do fundador): ele **coleta o feedback, reconhece o retorno e registra**; a mudança concreta no treino vem do **profissional CREF via Dashboard** (US-5.5, edição validada pelo `ValidationService`) ou fica para a Fase 2. Nenhuma nova versão de protocolo é gerada automaticamente pelo check-in. A nota do schema `checkins.adjustments`/`newProtocolId` sobre ajuste automático fica **fora do MVP** (colunas nulas até a Fase 2).
2. **Disparo semanal idempotente** (schema): `CheckinWeeklyWorker` via BullMQ `repeat` na janela **segunda 08–10h America/Sao_Paulo**; o `UNIQUE(user_id, protocol_id, week_number)` garante que failover/reprocesso **não gera dois check-ins da mesma semana**.
3. **PAR-Q de risco só é liberado por humano** (Alexandre, BLOQUEADOR): sessões `BLOCKED_PENDING_CLEARANCE` **nunca** são auto-liberadas — a liberação é uma ação explícita do profissional CREF no painel. Esta sprint é a que finalmente dá essa ação.
4. **Dashboard CREF é autenticado** (RBAC `PROFESSIONAL`/`ADMIN`, `password_hash` Argon2id, sessão segura): diferente das telas de usuário por token. A policy RLS do profissional difere da do titular via `app.current_role`; o profissional vê apenas o que a sua policy permite.
5. **Assinatura eletrônica = login autenticado + timestamp + hash** (Rafael, não ICP-Brasil no MVP): toda liberação/edição/assinatura de protocolo pelo profissional registra `professional_id` + timestamp + `signature_hash` do conteúdo — trilha de auditoria imutável (`audit_logs` append-only da Sprint 1).
6. **Replays de conversa no painel são anonimizados** (Sato/LGPD): o PII Scrubber (US-2.2) roda sobre a conversa antes de exibi-la ao profissional — o painel serve para melhorar o sistema e supervisionar, não para expor PII em claro desnecessariamente.
7. **Guardrails de linguagem** em todo texto de check-in, loop de reconhecimento, reengajamento e no painel (Sofia §13): nunca "diagnóstico"/"tratamento"/"cura"/"resultado garantido"; MOVI sempre ferramenta do profissional CREF; respaldo CREF visível.
8. **Dor/desconforto no check-in é dado de saúde** (schema, Art. 11): um relato de **dor anormal/articular** no check-in **dispara `handoff_alerts` (SAFETY)** e orienta o usuário a parar + procurar avaliação — nunca vira ajuste automático de carga.
9. **Loop de reconhecimento** (Lucas/Sofia, adaptado ao MVP): o usuário que fez check-in recebe um **reconhecimento acolhedor** ("recebi seu retorno 👍 — vou acompanhar sua evolução e o profissional pode ajustar seu plano quando precisar") — **sem prometer mudança automática**. A "mudança concreta" no treino, no MVP, é decisão do profissional CREF pelo painel (US-5.5); o loop visível de ajuste automático é Fase 2.
10. **Todo merge para `main`** passa por PR + os 6 checks verdes do CI; cobertura ≥80%; testes de idempotência do disparo, de cifra das respostas, da política do check-in (dor→handoff/sinalização), de edição validada no painel, de auth/RBAC e de isolamento **bloqueantes**. Nenhum push direto.

---

# ÉPICO 6 — Check-in Semanal e Retenção · ÉPICO 7 — Supervisão CREF e Operações

### Descrição

Fechar o **ciclo de retenção** e a **supervisão humana** da MOVIVO. O check-in semanal (Épico 6) é o mecanismo que sustenta a **North Star (treinos concluídos por usuário pago/30 dias)** e transforma "informação" em "coaching real": toda segunda-feira MOVI pergunta como foi a semana em **3 quick replies** (semáforo de cansaço, treinos completados, pedido de ajuste); no MVP o feedback é **coletado (cifrado), reconhecido** com um loop acolhedor e **registrado** — e **sinaliza o profissional** quando pede atenção (pedido de ajuste, baixa aderência, e — exceção de segurança — dor anormal → handoff `SAFETY`). **Não há ajuste automático de protocolo no MVP** (decisão do fundador): a mudança concreta vem do profissional pelo painel. Inativos por 2 semanas recebem um **nudge de retorno** sem julgamento. O Dashboard CREF (Épico 7) é onde a **supervisão humana acumulada de três sprints** finalmente acontece: o profissional CREF (conta única — Leonardo/RT CREF) faz login autenticado e vê a **fila de supervisão** — protocolos `PENDING_REVIEW` (da Sprint 2), `handoff_alerts` (`ALERT`/`SAFETY`), sessões `BLOCKED_PENDING_CLEARANCE` (PAR-Q de risco) e as **sinalizações de check-in** — e pode **editar (validado), assinar e liberar** protocolos per-usuário, com trilha de auditoria (login+timestamp+hash). O painel também entrega **operações** — funil, alerta de SLA e replays de conversa anonimizados. Fecha com uma US de **QA + segurança** (idempotência, cifra, política do check-in, edição validada, auth/RBAC do painel, isolamento, replays anonimizados) como gate bloqueante.

### Objetivo

Ao final da Sprint 5: um usuário pagante recebe toda segunda-feira o check-in em 3 botões; ao responder, seu feedback é **coletado (cifrado), reconhecido e registrado**, e o profissional é **sinalizado** quando pede atenção; um relato de dor anormal vira **handoff SAFETY** (parar + procurar avaliação), não ajuste de carga; se ficar inativo 2 semanas, recebe um **nudge de retorno** sem julgamento. E o profissional CREF (conta única), autenticado, **finalmente consegue** revisar/editar/assinar/liberar os protocolos `PENDING_REVIEW`, atender os `handoff_alerts`/sinalizações e **liberar as sessões PAR-Q de risco** que estavam bloqueadas — com auditoria, isolamento e replays anonimizados. O MVP fica completo e legalmente defensável.

### Resultado esperado dos épicos

- **`CheckinWeeklyWorker`** sobre `checkin-weekly`: disparo semanal (segunda 08–10h America/Sao_Paulo) via `repeat`, **idempotente** (`UNIQUE(user_id, protocol_id, week_number)`), só para pagantes (`ACTIVE`); 3 quick replies (Sofia §11.5); abre com vitória (positivity bias); **respostas cifradas** (pgcrypto, Art. 11).
- **Coleta + loop de reconhecimento + sinalização (SEM ajuste automático):** a resposta é registrada (cifrada); o usuário recebe um reconhecimento acolhedor; pedido explícito de ajuste / baixa aderência → **sinaliza o painel**; **dor anormal → `handoff_alerts` (SAFETY)** + orientação de parar. Nenhuma nova versão de protocolo gerada automaticamente (ajuste automático = Fase 2).
- **Reengajamento de inativos:** 2 semanas sem resposta → **nudge de retorno** sem julgamento (mensagem; geração de protocolo de retorno = Fase 2).
- **AuthModule do profissional (conta única) + shell do dashboard:** login autenticado (Auth.js/Next.js sobre RBAC `PROFESSIONAL`/`ADMIN`, Argon2id — um só profissional, RBAC mínimo), sessão segura, RLS por `app.current_role`.
- **Fila de supervisão + assinatura/edição/liberação:** lista de `PENDING_REVIEW` + `handoff_alerts` + `BLOCKED_PENDING_CLEARANCE` + sinalizações de check-in; o profissional edita (**validado pelo `ValidationService`**)/assina/libera protocolos e **libera as sessões PAR-Q** (ação humana obrigatória); trilha de auditoria login+timestamp+hash.
- **Operações:** funil (form→protocolo→primeiro treino→conversão), alerta de SLA, replays de conversa **anonimizados** (PII Scrubber); notificação real-time (Socket.io) de novos itens na fila.
- **Quality gate** bloqueante: idempotência do disparo, cifra das respostas, política do check-in (dor→handoff/sinalização), edição validada no painel, auth/RBAC, isolamento por titular, replays anonimizados. Revisão de Sato + validação de Alexandre/RT CREF registradas.
- CI verde; cobertura ≥80%; toda entrega via PR + 6 checks.

### Não-escopo desta sprint (para não haver ambiguidade)

A fronteira da Sprint 5 é **"retenção + supervisão humana"** — fecha o MVP. Ficam **explicitamente fora** (Fase 2 do produto, Lucas §MVP):

- **App mobile nativo, dashboard/portal dedicado ao usuário final, wearables, gamificação (streaks/badges), referral automatizado, nutrition coaching, PIX recorrente, multi-idioma, API B2B.** O check-in e o painel do MVP são suficientes para validar retenção e supervisão; escalar cada um é Fase 2.
- **Assinatura eletrônica ICP-Brasil:** no MVP a assinatura é **login autenticado + timestamp + hash** (Rafael) — cobre o requisito de auditoria inicial. Certificado ICP-Brasil é Fase 2, se a escala/exigência regulatória pedir.
- **Ajuste automático de protocolo pelo check-in (via gera-e-valida):** decisão do fundador — **fora do MVP**. O check-in coleta/sinaliza; a mudança concreta é do profissional pelo painel (US-5.5). O pipeline gera-e-valida da Sprint 2 pluga na US-5.2 quando o RT ratificar o mapa feedback→ajuste (Fase 2). Idem o ajuste em tempo real fora do check-in (coaching avançado) e a geração automática do protocolo simplificado de retorno da US-5.3.
- **A/B test de timing do check-in (domingo à noite vs. segunda de manhã):** o MVP fixa segunda 08–10h (janela do schema/§8); o experimento de timing é otimização pós-tração.
- **Analytics avançado / cohort self-service / experimentação (Growth, Fase 8):** o painel de operações do MVP entrega o funil e o alerta de SLA; dashboards de growth sofisticados são fase posterior do pipeline.
- **Gestão de múltiplos profissionais no painel:** o MVP tem **um único profissional** (Leonardo/RT CREF) — auth de conta única, sem convite/gestão de equipe. Multi-profissional é Fase 2.

### Mapa de dependências entre User Stories

```
ÉPICO 6 — CHECK-IN
US-5.1 (CheckinWeeklyWorker: disparo semanal idempotente + 3 quick replies + cifra · Leonardo) ─┐
US-5.2 (Resposta: coleta + loop de reconhecimento + sinalização ao painel · Leonardo) ─────────┤
        └── depende de US-5.1 (SEM ajuste automático no MVP)                                    │
US-5.3 (Reengajamento de inativos: nudge de retorno · Leonardo) ── dep 5.1/5.2

ÉPICO 7 — DASHBOARD CREF
US-5.4 (Auth do profissional (conta única) + shell do dashboard · Felipe+Leonardo+Sato) ── REUSA AuthModule │
US-5.5 (Fila de supervisão + edição validada/assinatura/liberação · Felipe+Leonardo+Alexandre) ────────────┤
        └── depende de US-5.4 + lê PENDING_REVIEW/handoff_alerts/BLOCKED + sinais de check-in + REUSA ValidationService
US-5.6 (Operações: funil + alerta SLA + replays anonimizados · Felipe+Henrique) ── dep US-5.4  │
US-5.7 (QA + segurança do check-in e do painel · Mariana+Sato) ── valida US-5.1 a 5.6 ─────────┘
```

**Interligação dos dois épicos:** o check-in (US-5.2) **sinaliza o painel** (pedido de ajuste, baixa aderência, dor→handoff SAFETY) e essas sinalizações **entram na fila de supervisão (US-5.5)** junto com a dívida acumulada (`PENDING_REVIEW`, `handoff_alerts`, `BLOCKED_PENDING_CLEARANCE`). É o elo entre os épicos: no MVP o painel é o **único** lugar onde a mudança concreta de treino acontece (edição validada pelo profissional), já que o check-in não auto-ajusta.

**Sequência prática recomendada (10 dias úteis):** **US-5.1 (worker de check-in) e US-5.4 (auth + shell do dashboard) começam no dia 1 em paralelo** — as duas fundações independentes (Leonardo no worker; Felipe/Leonardo no auth do painel, com Sato validando). US-5.2 (coleta/reconhecimento/sinalização) dias 3-6. US-5.5 (fila de supervisão + edição validada + assinatura) dias 3-8, sobre o auth. US-5.3 (reengajamento) dias 6-8. US-5.6 (operações) dias 5-9. US-5.7 (QA + segurança) corre do dia 3 ao 10, fechando a sprint e o MVP.

---

## US-5.1 — CheckinWeeklyWorker: disparo semanal idempotente + 3 quick replies

**Agentes:** Leonardo (lead — worker, `repeat`, idempotência, quick replies) · Sofia (referência — formato/copy do check-in, momento de vitória) · Henrique (colabora — scheduler/timezone, observabilidade do disparo).
**Depende de:** fila `checkin-weekly` (US-1.7), outbound WhatsApp (US-2.5), assinatura `ACTIVE` (Sprint 4), tabela `checkins` (Sprint 0/1). É uma das **duas US que começam no dia 1**.
**Habilita:** US-5.2 (a resposta do check-in é coletada/reconhecida/sinalizada) e US-5.3 (inatividade se mede a partir do disparo/resposta).

### Jornada

Aqui vive o mecanismo de retenção central (Lucas Épico 6, Sofia §11.5): toda segunda-feira MOVI abre com uma **vitória** ("semana passada você mandou bem — 3 treinos!") antes de perguntar, para maximizar a taxa de resposta (positivity bias). O check-in são **3 perguntas por quick reply** (máx 3 botões, o limite de Sofia): **(1) semáforo de cansaço** (🟢/🟡/🔴), **(2) treinos completados** na semana, **(3) pedido de ajuste** (quero mais leve / tá bom / quero mais desafio). Leonardo implementa o `CheckinWeeklyWorker` sobre `checkin-weekly` (`attempts: 3`, backoff 5/15/45s) disparado por **BullMQ `repeat`** na janela **segunda 08–10h America/Sao_Paulo** (§8). A **idempotência é garantida pelo schema**: `INSERT` em `checkins` com `UNIQUE(user_id, protocol_id, week_number)` — um failover do scheduler que reprocessa a mesma semana colide no índice e não gera um segundo check-in nem um segundo envio. Só dispara para **pagantes** (`ACTIVE`) — o check-in semanal é a retenção dos assinantes (a North Star é "treinos concluídos por usuário **pago**"); trialists no dia 7 já são cobertos pela sequência de conversão (Sprint 4). O envio usa o outbound (persona MOVI, quick replies). Henrique cuida do timezone e da observabilidade do disparo.

### Objetivo

Ter o `CheckinWeeklyWorker` disparando o check-in de 3 quick replies toda segunda 08–10h (America/Sao_Paulo), idempotente por `UNIQUE(user, protocol, week)`, só para pagantes, abrindo com vitória.

### Resultado esperado

Um pagante recebe na segunda o check-in com 3 botões e uma abertura positiva; um failover do scheduler não gera check-in duplicado da mesma semana; um usuário em trial/cancelado não recebe o check-in; a resposta é gravada em `checkins.responses`.

### Tasks

**TASK-5.1.1 — Worker + scheduler repetível na janela de segunda (Leonardo + Henrique).**
Implementar o `CheckinWeeklyWorker` sobre `checkin-weekly` (parâmetros US-1.7) com BullMQ `repeat` na janela **segunda 08–10h America/Sao_Paulo** (§8). Selecionar os usuários elegíveis (assinatura `ACTIVE`, com protocolo `ACTIVE`, na semana corrente). Henrique valida o timezone (DST não aplica ao Brasil desde 2019, mas fixar America/Sao_Paulo explicitamente) e a observabilidade do disparo (quantos enviados/semana).
**Conclusão:** check-in dispara na janela correta só para pagantes; timezone fixado; métrica de disparo instrumentada.

**TASK-5.1.2 — Idempotência via UNIQUE(user, protocol, week) (Leonardo).**
Registrar cada check-in com `INSERT` em `checkins` sob a constraint `UNIQUE(user_id, protocol_id, week_number)` (schema): a colisão é o mecanismo de idempotência — reprocesso/failover não cria segundo check-in nem segundo envio (checar a constraint antes de enfileirar o outbound). Sob RLS/`SET LOCAL`.
**Conclusão:** reprocessar a mesma (user, protocol, week) não duplica check-in nem envio; teste de idempotência verde.

**TASK-5.1.3 — Formato de 3 quick replies + abertura com vitória (Leonardo + Sofia ref.).**
Montar a mensagem de check-in (Sofia §11.5): abre com uma **vitória** concreta (treinos da semana anterior), depois **3 perguntas por quick reply** (semáforo de cansaço; treinos completados; pedido de ajuste). Copy nos guardrails, persona MOVI, respaldo CREF. Emitir `checkin_sent`/`checkin_responded` (PostHog). (A persistência da resposta é da US-5.2, cifrada.)
**Conclusão:** check-in com abertura positiva + 3 botões; eventos emitidos; copy aprovada nos guardrails.

**TASK-5.1.4 — Cifra em repouso de `checkins.responses` (Leonardo + Alexandre).**
Cifrar `checkins.responses` com **pgcrypto**, reusando o helper `health-cipher` da anamnese (US-1.1) — a resposta de dor/desconforto é dado de saúde (Art. 11). Cifra em repouso, decifra sob `SET LOCAL`/RLS apenas no contexto autorizado. Migração aplica a cifra à coluna. (Decisão do fundador: entra nesta sprint, deixa de ser dívida pré-lançamento.)
**Conclusão:** `responses` cifrado em repouso com o mesmo padrão da anamnese; decifra só sob RLS; teste prova que a coluna não guarda texto em claro.

### Definição de Pronto (US-5.1 "validada")

- [ ] Tasks 5.1.1–5.1.4 concluídas.
- [ ] Disparo semanal na janela de segunda (America/Sao_Paulo), idempotente por `UNIQUE(user, protocol, week)`, só para pagantes; 3 quick replies + abertura com vitória; **respostas cifradas em repouso** (pgcrypto).
- [ ] **Validada por:** code review + revisão de copy (Sofia/guardrails) + teste de idempotência do disparo + teste de cifra verde (US-5.7).

---

## US-5.2 — Resposta do check-in: coleta, loop de reconhecimento e roteamento ao painel (SEM ajuste automático no MVP)

**Agentes:** Leonardo (lead — persistência da resposta cifrada, loop de reconhecimento, roteamento ao painel) · Sofia (referência — copy do loop, tom) · Alexandre / RT CREF (validam a política de segurança do check-in).
**Depende de:** US-5.1 (a resposta) e `handoff_alerts` (US-3.6). Dias 3-7.
**Habilita:** US-5.5 (respostas que pedem atenção do profissional entram na fila do painel).

### Jornada

**Decisão do fundador (2026-08-01): SEM ajuste automático de protocolo no MVP.** O check-in **coleta o feedback, reconhece o retorno e registra** — não re-gera o treino sozinho. A mudança concreta no protocolo, quando fizer sentido, é decisão do **profissional CREF via Dashboard** (US-5.5, edição validada) ou fica para Fase 2 (o pipeline gera-e-valida da Sprint 2 continua pronto para ser plugado aqui quando o RT CREF ratificar o mapa feedback→ajuste). Então, ao receber a resposta (cansaço/treinos/pedido de ajuste), Leonardo **persiste em `checkins.responses` (cifrado, US-5.1)**, envia um **loop de reconhecimento** ("recebi seu retorno 👍 — vou acompanhar sua evolução e o profissional pode ajustar seu plano quando precisar", nos guardrails, sem prometer mudança automática), e **sinaliza ao painel** quando a resposta pede atenção humana (pedido explícito de ajuste, baixa aderência recorrente). **Exceção de segurança (inalterada, crítica):** um relato de **dor anormal/articular** na resposta **NÃO** vira ajuste nem é tratado como feedback comum — dispara **`handoff_alerts` (SAFETY)** + orientação ao usuário de **parar e procurar avaliação presencial** (mesma regra do guardrail clínico da Sprint 3). A nota do schema `checkins.adjustments`/`newProtocolId` sobre ajuste automático fica **fora do MVP** (colunas podem ficar nulas até a Fase 2). Alexandre/RT CREF validam a política (o que sinaliza o painel, o que dispara handoff).

### Objetivo

Ter a resposta do check-in **coletada e cifrada**, com **loop de reconhecimento** ao usuário e **roteamento ao painel** quando pede atenção humana — **sem** ajuste automático de treino; dor anormal → handoff SAFETY.

### Resultado esperado

Uma resposta de check-in é gravada (cifrada) e o usuário recebe um reconhecimento acolhedor sem promessa de mudança automática; um **pedido explícito de ajuste** (ou aderência baixa recorrente) **sinaliza o painel** para o profissional decidir; um relato de **dor articular** vira **handoff SAFETY** + orientação de parar, **nunca** ajuste; nenhuma nova versão de protocolo é gerada automaticamente no MVP.

### Tasks

**TASK-5.2.1 — Persistir a resposta (cifrada) + loop de reconhecimento (Leonardo + Sofia ref.).**
Gravar as respostas em `checkins.responses` **cifradas** (pgcrypto, US-5.1) sob RLS. Enviar ao usuário um **loop de reconhecimento** (persona MOVI, guardrails) que confirma o recebimento e valoriza a continuidade — **sem** prometer ajuste automático. Emitir `checkin_responded` (PostHog).
**Conclusão:** resposta cifrada e persistida sob RLS; usuário recebe reconhecimento nos guardrails; evento emitido.

**TASK-5.2.2 — Roteamento ao painel + exceção de segurança (Leonardo + Alexandre).**
**Dor anormal/articular na resposta → `handoff_alerts` (SAFETY)** + orientação de segurança (parar + procurar avaliação) — nunca ajuste de carga. **Pedido explícito de ajuste** ou **baixa aderência recorrente** → registra sinal consultável para o painel (US-5.5) para o profissional decidir a mudança. Sob RLS. Alexandre/RT CREF validam os gatilhos.
**Conclusão:** dor anormal vira handoff SAFETY; pedido de ajuste/baixa aderência sinaliza o painel; nada de ajuste automático; gatilhos validados por escrito.

### Definição de Pronto (US-5.2 "validada")

- [ ] Tasks 5.2.1–5.2.2 concluídas.
- [ ] Resposta cifrada e persistida sob RLS; loop de reconhecimento sem promessa de ajuste automático; pedido de ajuste/baixa aderência sinaliza o painel; **dor anormal → handoff SAFETY**; **nenhuma** nova versão de protocolo gerada automaticamente (fora do MVP).
- [ ] **Validada por:** code review + **aprovação do RT CREF / Alexandre** (política de sinalização/handoff) + revisão de copy (Sofia/guardrails) + teste verde (US-5.7).
- [ ] **Fase 2 (fora do MVP):** ajuste automático via gera-e-valida (o pipeline da Sprint 2 pluga aqui quando o RT ratificar o mapa feedback→ajuste).

---

## US-5.3 — Reengajamento de inativos: nudge de retorno

**Agentes:** Leonardo (lead — detecção de inatividade, nudge de retorno) · Sofia (referência — tom sem julgamento).
**Depende de:** US-5.1/US-5.2 (inatividade se mede a partir do ciclo de check-in). Dias 6-8.
**Habilita:** recuperação de churn silencioso (Lucas Épico 6, gap 4 de reengajamento).

### Jornada

Lucas marcou a ausência de reengajamento como um gap destruidor de LTV: **o que acontece se o usuário some?** (Épico 6). Leonardo implementa a detecção de inatividade — **2 semanas sem responder o check-in** (ou sem treino auto-reportado, corte inicial confirmado pelo fundador) — que dispara um **nudge de retorno sem julgamento** (Sofia): uma mensagem acolhedora que reconhece a ausência, convida a retomar e reforça o respaldo CREF, **sem cobrança nem culpa**. Coerente com a decisão do fundador de **não haver ajuste automático de protocolo no MVP**, o nudge é uma **mensagem** — ele **não gera** um protocolo simplificado de retorno automaticamente. Se o usuário quiser um plano mais leve para voltar, isso é uma decisão do **profissional pelo painel** (US-5.5) ou fica para a Fase 2 (a geração via gera-e-valida com constraint de "retorno" pluga aqui quando o ajuste automático entrar). Copy nos guardrails, persona MOVI.

### Objetivo

Ter a detecção de inatividade (2 semanas sem check-in/treino) disparando um nudge de retorno sem julgamento — sem geração automática de protocolo.

### Resultado esperado

Um usuário 2 semanas sem responder recebe uma mensagem acolhedora convidando a retomar; o nudge dispara uma única vez; a copy não julga nem cobra; nenhum protocolo é gerado automaticamente.

### Tasks

**TASK-5.3.1 — Detecção de inatividade + nudge de retorno (Leonardo + Sofia ref.).**
Detectar 2 semanas sem resposta de check-in (ou sem treino reportado) e disparar o nudge de retorno sem julgamento (Sofia): acolhe, convida a retomar, reforça o respaldo CREF. Idempotente (não repetir a cada job; um nudge por janela de inatividade). Emitir `reengagement_sent`/`reengagement_responded` (PostHog).
**Conclusão:** inatividade de 2 semanas dispara o nudge uma vez; copy sem julgamento nos guardrails; eventos emitidos; nenhum protocolo gerado.

### Definição de Pronto (US-5.3 "validada")

- [ ] Task 5.3.1 concluída.
- [ ] Inatividade de 2 semanas dispara o nudge de retorno sem julgamento; idempotente; **sem geração automática de protocolo** (protocolo simplificado de retorno = Fase 2 ou decisão do profissional no painel).
- [ ] **Validada por:** code review + revisão de copy (Sofia/guardrails) + teste de detecção/idempotência verde (US-5.7).
- [ ] **Fase 2 (fora do MVP):** geração automática do protocolo simplificado de retorno via gera-e-valida.

---

## US-5.4 — Autenticação do profissional + shell do Dashboard CREF

**Agentes:** Felipe (lead — Auth.js/Next.js, shell do dashboard) · Leonardo (colabora — endpoints autenticados, RLS por `app.current_role`) · Sato (valida auth/sessão/RBAC do painel — §9).
**Depende de:** AuthModule JWT RS256 + RBAC `PROFESSIONAL`/`ADMIN` (Sprint 1). É uma das **duas US que começam no dia 1**.
**Habilita:** US-5.5 (fila de supervisão) e US-5.6 (operações) — ambas vivem atrás do login.

### Jornada

O Dashboard CREF é a **primeira superfície autenticada do produto** (Rafael/Sato §9.2): diferente das telas de usuário do MVP (não-autenticadas, por token opaco, ADR-006), o painel exige **login do profissional** — `PROFESSIONAL` e `ADMIN` são os únicos papéis com `password_hash` (Argon2id, US-1.4). **Decisão do fundador: há um único profissional no MVP (Leonardo/RT CREF)** — então a auth é de **conta única, RBAC mínimo**, sem convite/gestão de múltiplos profissionais (multi-profissional é Fase 2). Felipe constrói a autenticação de sessão (Auth.js/Next.js sobre o RBAC/JWT existente) e o **shell do dashboard** (layout, navegação, guarda de rota por papel) sobre o design system "O Pulso". Leonardo expõe os endpoints autenticados sob **RLS com `app.current_role`** — a policy do profissional difere da do titular (Sato §4.3): o profissional vê a fila de supervisão que sua policy permite, não pode ler dado fora do seu escopo. Sato valida a auth (sessão segura, httpOnly, rotation, `alg` fixo — T-09), o RBAC e a proteção contra escalonamento. Em dev, um profissional-seed com `password_hash` de teste.

### Objetivo

Ter a autenticação de sessão do profissional (Auth.js sobre o RBAC existente) e o shell do dashboard com guarda de rota por papel, servido por endpoints sob RLS por `app.current_role`.

### Resultado esperado

Um profissional faz login e acessa o shell do dashboard; um usuário sem papel `PROFESSIONAL`/`ADMIN` é barrado; as rotas do painel exigem sessão válida; os endpoints leem sob a policy do profissional; sessão segura (httpOnly/rotation/`alg` fixo).

### Tasks

**TASK-5.4.1 — Autenticação de sessão do profissional (Felipe + Leonardo + Sato).**
Implementar login do profissional (Auth.js/Next.js) sobre o AuthModule JWT/RBAC (Sprint 1): `password_hash` Argon2id, sessão httpOnly + refresh rotation + `alg` fixo (Sato §9.3, T-09). Guarda de rota por papel (`PROFESSIONAL`/`ADMIN`). Profissional-seed em dev.
**Conclusão:** login funciona; sessão segura; rota do painel exige papel correto; não-profissional barrado; Sato valida a auth.

**TASK-5.4.2 — Shell do dashboard + endpoints sob RLS por role (Felipe + Leonardo).**
Construir o shell (layout/navegação/guarda) sobre "O Pulso"; endpoints autenticados sob **RLS com `SET LOCAL app.current_role`** (Sato §4.3) — a policy do profissional/admin difere da do titular. WCAG 2.2 AA. Nenhum endpoint aceita `user_id` do cliente (escopo pela sessão/policy).
**Conclusão:** shell renderiza atrás do login; endpoints leem sob a policy do profissional; sem IDOR; a11y ok.

### Definição de Pronto (US-5.4 "validada")

- [ ] Tasks 5.4.1–5.4.2 concluídas.
- [ ] Login do profissional (Argon2id, sessão segura, RBAC) + shell do dashboard; endpoints sob RLS por `app.current_role`; sem escalonamento/IDOR.
- [ ] **Validada por:** code review + **revisão de segurança de Sato** (auth/sessão/RBAC — §9, T-09) + teste de guarda de rota/RLS verde (US-5.7).

---

## US-5.5 — Fila de supervisão CREF: revisão, edição, assinatura e liberação de protocolos

**Agentes:** Felipe (lead — UI da fila, editor, ações) · Leonardo (colabora — endpoints de assinatura/edição/liberação, auditoria) · Alexandre / RT CREF (validam o fluxo de supervisão, assinatura e liberação PAR-Q).
**Depende de:** US-5.4 (auth/shell), e lê `PENDING_REVIEW` (US-2.4), `handoff_alerts` (US-3.6 + sinalizações do check-in US-5.2), `BLOCKED_PENDING_CLEARANCE` (US-2.4); **REUSA** o `ValidationService` para validar edições manuais. Dias 3-8.
**Habilita:** a defensabilidade jurídica do MVP — a supervisão CREF acontecendo de fato.

### Jornada

Esta é a US que **paga a dívida de supervisão de três sprints**. O profissional CREF (conta única), autenticado (US-5.4), vê uma **fila de supervisão** unificada com três origens: **(1) protocolos `PENDING_REVIEW`** — os que o validador flagou na Sprint 2; **(2) `handoff_alerts`** — `SAFETY` (red flag clínica, prioritário) no topo, `ALERT` (revisão assíncrona) abaixo, ordenados por nível/tempo (o índice `idx_handoff_alerts_queue` do schema), incluindo as **sinalizações do check-in** (dor→SAFETY, pedido de ajuste/baixa aderência→ALERT, US-5.2); **(3) sessões `BLOCKED_PENDING_CLEARANCE`** — PAR-Q de risco que **nunca foram liberadas** porque não havia tela. O profissional pode: **revisar** o protocolo/contexto (com o replay de conversa anonimizado, US-5.6), **editar** o protocolo manualmente (a edição passa pelo `ValidationService` — nem o humano aplica treino que o validador reprova sem override consciente), **assinar** (login+timestamp+`signature_hash`, trilha em `audit_logs` append-only), e **liberar** — incluindo a **liberação humana obrigatória das sessões PAR-Q de risco** (Alexandre, BLOQUEADOR): essa é a ação que desbloqueia o segmento que estava preso. Marcar `handoff_alerts.status` resolvido. Alexandre/RT CREF validam o fluxo, a assinatura e o modelo de liberação.

### Objetivo

Ter a fila de supervisão unificada (`PENDING_REVIEW` + `handoff_alerts` + `BLOCKED_PENDING_CLEARANCE`) com as ações de revisar/editar/assinar/liberar, edição validada, liberação PAR-Q humana e trilha de auditoria.

### Resultado esperado

O profissional vê os itens pendentes ordenados por prioridade (SAFETY primeiro); edita um protocolo e a edição é validada; assina com timestamp+hash registrados em auditoria; libera uma sessão PAR-Q de risco que estava bloqueada (o usuário passa a poder receber protocolo); resolve um handoff; nada disso vaza dado fora do escopo.

### Tasks

**TASK-5.5.1 — Fila de supervisão unificada (Felipe + Leonardo).**
UI da fila lendo `PENDING_REVIEW` (protocols), `handoff_alerts` (ordenado `SAFETY`→`ALERT` por tempo, índice `idx_handoff_alerts_queue`) e sessões `BLOCKED_PENDING_CLEARANCE`, sob RLS por role. Notificação real-time (Socket.io, Rafael) de novos itens. Contexto por item (protocolo, motivo, conversa anonimizada de US-5.6).
**Conclusão:** fila mostra as três origens priorizadas; novos itens notificam em tempo real; contexto acessível; leitura sob policy.

**TASK-5.5.2 — Edição validada + assinatura eletrônica auditada (Felipe + Leonardo + Alexandre).**
Editor de protocolo cuja saída passa pelo **`ValidationService`** (reuso — nem edição humana aplica treino que o validador reprova sem override registrado). Assinatura = login autenticado + timestamp + `signature_hash` do conteúdo → `protocol_versions` + `audit_logs` (append-only, hash chain da Sprint 1). Alexandre valida o modelo de assinatura per-usuário (o que a Sprint 2 deixou para cá).
**Conclusão:** edição validada; assinatura registra profissional+timestamp+hash em auditoria; Alexandre valida o modelo por escrito.

**TASK-5.5.3 — Liberação humana das sessões PAR-Q de risco (Leonardo + Felipe + Alexandre).**
Ação de **liberar** sessão `BLOCKED_PENDING_CLEARANCE` (PAR-Q de risco) — **ação humana obrigatória** (Alexandre, BLOQUEADOR): após a liberação, a sessão volta ao fluxo de geração (ou o profissional assina um protocolo adaptado). Resolver `handoff_alerts` (`status`). Registrar tudo em auditoria. A liberação **nunca** é automática.
**Conclusão:** sessão PAR-Q liberada só por ação humana; usuário liberado passa a poder receber protocolo; handoff resolvido; auditoria registrada; Alexandre valida.

### Definição de Pronto (US-5.5 "validada")

- [ ] Tasks 5.5.1–5.5.3 concluídas.
- [ ] Fila unificada (PENDING_REVIEW + handoff_alerts SAFETY/ALERT + BLOCKED_PENDING_CLEARANCE) com revisar/editar/assinar/liberar; edição validada; assinatura auditada; liberação PAR-Q humana obrigatória.
- [ ] **Validada por:** code review + **validação de Alexandre / RT CREF** (supervisão/assinatura/liberação PAR-Q) + revisão de Sato (RLS/auditoria) + teste dos fluxos verde (US-5.7).

---

## US-5.6 — Operações: funil, alerta de SLA e replays de conversa anonimizados

**Agentes:** Felipe (lead — telas de operações) · Henrique (colabora — métricas/alertas de SLA, observabilidade) · Sato (valida anonimização dos replays).
**Depende de:** US-5.4 (auth/shell). Dias 5-9.
**Habilita:** a operação do produto (Lucas Épico 7) — enxergar o funil e agir antes que usuários abandonem.

### Jornada

Lucas (Épico 7) pediu que o time enxergue o funil em tempo real e seja alertado quando o SLA escorregar. Felipe constrói, dentro do painel autenticado, as telas de **operações**: **(1) funil** (form iniciado → protocolo enviado → primeiro treino → conversão) a partir dos eventos PostHog já instrumentados nas Sprints 1-4; **(2) alerta de SLA** — quando o SLA de entrega do protocolo (≤2h) ou de resposta do Coach (≤30s p95) escorrega, o time é alertado (Henrique liga ao Prometheus/Grafana/alertas já existentes); **(3) replays de conversa anonimizados** — para identificar perguntas mal respondidas e melhorar o sistema (Lucas Épico 7), com o **PII Scrubber (US-2.2) rodando sobre a conversa antes de exibi-la** (Sato/LGPD: o profissional supervisiona, não precisa de PII em claro). Sato valida a anonimização.

### Objetivo

Ter, no painel autenticado, o funil de operações, o alerta de SLA e os replays de conversa anonimizados — para o time enxergar gargalos e melhorar o sistema.

### Resultado esperado

O time vê o funil por etapa; um SLA estourado dispara alerta; os replays de conversa aparecem sem PII em claro; tudo atrás do login.

### Tasks

**TASK-5.6.1 — Funil de operações + alerta de SLA (Felipe + Henrique).**
Tela de funil (form→protocolo→primeiro treino→conversão) a partir dos eventos PostHog das Sprints 1-4; painel de SLA (entrega ≤2h, resposta ≤30s p95) com alerta quando escorrega (Henrique liga ao Grafana/alertas). Sob login.
**Conclusão:** funil renderiza por etapa; alerta de SLA dispara quando estoura; atrás do login.

**TASK-5.6.2 — Replays de conversa anonimizados (Felipe + Sato).**
Exibir replays de conversa com o **PII Scrubber (US-2.2)** aplicado antes da exibição (Sato/LGPD). Escopo de leitura sob policy do profissional. Sato valida que nenhum identificador direto aparece.
**Conclusão:** replays sem PII em claro; leitura sob policy; Sato valida a anonimização.

### Definição de Pronto (US-5.6 "validada")

- [ ] Tasks 5.6.1–5.6.2 concluídas.
- [ ] Funil de operações + alerta de SLA + replays de conversa anonimizados, atrás do login.
- [ ] **Validada por:** code review + **revisão de Sato** (anonimização/LGPD) + teste de anonimização verde (US-5.7).

---

## US-5.7 — QA e segurança do check-in e do painel (fecha o MVP)

**Agentes:** Mariana (lead — testes, cobertura, quality gates) · Sato (revisão de segurança: auth/RBAC do painel, isolamento, anonimização, liberação PAR-Q, cifra).
**Depende de:** US-5.1 a US-5.6 (há o que testar). **Alimenta** o CI (quality gate). **Fecha o MVP.**
**Habilita:** a entrada segura da Sprint 5 em `main` e o critério de "pronto para Fase 2" (Lucas §MVP).

### Jornada

A Sprint 5 fecha o MVP — e junta os dois riscos mais sensíveis desta sprint: **a política de segurança do check-in sobre dado de saúde** (dor anormal precisa virar handoff, nunca ajuste; a resposta precisa ficar cifrada) e **a primeira superfície autenticada** (o painel do profissional, que pode editar/liberar protocolos de qualquer usuário). Como o fundador decidiu **não haver ajuste automático no MVP**, não há AI eval de ajuste a fazer — o que se testa é a **política do check-in** e a **edição validada no painel**. Mariana constrói a suíte como **quality gate bloqueante**: **idempotência do disparo** (failover não duplica check-in), **cifra das respostas** (`checkins.responses` nunca em claro em repouso), **política do check-in** (dor anormal → handoff SAFETY, nunca ajuste; pedido de ajuste/baixa aderência → sinalização; nenhum protocolo gerado automaticamente), **edição validada no painel** (o `ValidationService` veta edição humana insegura — a única via de mudança concreta no MVP), **auth/RBAC do painel** (não-profissional barrado; sessão segura; sem escalonamento), **isolamento por titular** (o profissional lê sob policy; nenhum vazamento cross-tenant; nenhum endpoint aceita `user_id` do cliente), **liberação PAR-Q humana** (sessão bloqueada nunca auto-libera), **anonimização dos replays** (0 PII em claro), e **auditoria** (assinatura registra profissional+timestamp+hash). Sato registra a revisão de segurança consolidada do painel. Fecha confirmando o critério de "pronto para Fase 2" (Lucas): retenção 30d, conversão, SLA.

### Objetivo

Cobertura ≥80% do código novo, suíte bloqueante (idempotência, cifra, política do check-in, edição validada, auth/RBAC, isolamento, liberação PAR-Q, anonimização, auditoria), e revisão de Sato + validação de Alexandre/RT CREF — tudo no CI, fechando o MVP.

### Resultado esperado

O CI reprova qualquer PR que: duplique o check-in num failover, deixe `checkins.responses` em claro, deixe dor anormal virar ajuste de carga (em vez de handoff), gere protocolo automaticamente pelo check-in, aplique uma edição de painel que o validador reprova, permita não-profissional acessar o painel, quebre o isolamento por titular, auto-libere uma sessão PAR-Q, exponha PII num replay, ou derrube a cobertura abaixo de 80%; os fluxos (check-in→reconhecimento→sinalização, reengajamento, fila→edição validada→assinatura→liberação) têm teste de integração verde; as revisões de Sato e Alexandre/RT CREF estão anexadas.

### Tasks

**TASK-5.7.1 — Idempotência + cifra + política do check-in (bloqueante) (Mariana).**
Testes: idempotência do disparo (`UNIQUE(user, protocol, week)` — failover não duplica); **cifra** (`checkins.responses` nunca em claro em repouso, decifra só sob RLS); **política do check-in** (dor anormal → handoff SAFETY, nunca ajuste; pedido de ajuste/baixa aderência → sinalização do painel; **nenhum protocolo gerado automaticamente pelo check-in**). **Gates bloqueantes.**
**Conclusão:** disparo duplicado plantado falha; resposta em claro falha; dor-anormal plantada vira handoff (não ajuste); qualquer geração automática de protocolo pelo check-in falha o teste.

**TASK-5.7.2 — Auth/RBAC do painel + isolamento + liberação PAR-Q (Mariana + Sato).**
Testes: auth do painel (não-profissional barrado; sessão segura; sem escalonamento — T-09); **isolamento por titular** (profissional lê sob policy; sem vazamento cross-tenant; nenhum endpoint aceita `user_id` do cliente); **liberação PAR-Q humana** (sessão `BLOCKED_PENDING_CLEARANCE` nunca auto-libera). Isolamento e liberação bloqueantes.
**Conclusão:** não-profissional barrado; vazamento cross-tenant falha o pipeline; auto-liberação de PAR-Q falha o pipeline.

**TASK-5.7.3 — Edição validada, anonimização, auditoria e integração ponta a ponta (Mariana + Sato + Leonardo).**
Testes: **edição de protocolo no painel passa pelo `ValidationService`** (edição humana insegura é vetada/exige override registrado); replays sem PII em claro (PII Scrubber); auditoria de assinatura (profissional+timestamp+hash em `audit_logs` append-only). Integração: check-in→reconhecimento→sinalização; dor→handoff SAFETY; reengajamento (nudge); fila→edição validada→assinatura→liberação PAR-Q.
**Conclusão:** edição insegura vetada; 0 PII nos replays; auditoria registrada; integração dos fluxos verde local e no CI.

**TASK-5.7.4 — Revisão de segurança de Sato + validação clínico-jurídica + fecho de MVP (Mariana + Sato + Alexandre/RT CREF).**
Sato registra a **revisão de segurança consolidada do painel** (auth, RBAC, isolamento, anonimização, auditoria). Alexandre/RT CREF validam o fluxo de supervisão/assinatura/liberação PAR-Q. Confirmar o critério "pronto para Fase 2" (Lucas §MVP): retenção 30d, conversão, SLA, NPS instrumentados.
**Conclusão:** revisão de Sato registrada; Alexandre/RT CREF validam; critério de Fase 2 instrumentado.

### Definição de Pronto (US-5.7 "validada")

- [ ] Tasks 5.7.1–5.7.4 concluídas.
- [ ] Idempotência, cifra das respostas, política do check-in (dor→handoff, sem ajuste automático), edição validada no painel, auth/RBAC, isolamento, liberação PAR-Q humana, anonimização e auditoria bloqueantes; integração dos fluxos verde.
- [ ] Cobertura ≥80%; gates integrados ao CI.
- [ ] **Validada por:** review de Mariana + **revisão de segurança de Sato registrada** + **validação de Alexandre / RT CREF** + CI verde.

---

## Matriz de responsabilidade por User Story (RACI simplificado)

| US | Título | Responsável (R) | Colabora (C) | Valida (V) |
|---|---|---|---|---|
| US-5.1 | CheckinWeeklyWorker: disparo semanal idempotente + 3 quick replies | **Leonardo** | Sofia (formato), Henrique (scheduler/tz) | Review + copy + idempotência (Mariana) |
| US-5.2 | Resposta do check-in: coleta + reconhecimento + sinalização (sem ajuste automático) | **Leonardo** | Sofia (copy do loop) | **Alexandre / RT CREF** (política de sinalização/handoff) + Mariana |
| US-5.3 | Reengajamento de inativos: nudge de retorno | **Leonardo** | Sofia (tom) | Review + copy + Mariana |
| US-5.4 | Auth do profissional (conta única) + shell do dashboard | **Felipe** | Leonardo (endpoints/RLS), Sato (segurança) | **Sato (auth/RBAC — §9)** + Mariana |
| US-5.5 | Fila de supervisão + edição validada/assinatura/liberação | **Felipe** | Leonardo (endpoints/auditoria) | **Alexandre / RT CREF** (supervisão/liberação) + Sato + Mariana |
| US-5.6 | Operações: funil + alerta SLA + replays anonimizados | **Felipe** | Henrique (SLA/obs.), Sato (anonimização) | **Sato (anonimização/LGPD)** + Mariana |
| US-5.7 | QA + segurança do check-in e do painel | **Mariana** | Sato, Leonardo | Mariana + **Sato** + **Alexandre / RT CREF** + gate no CI |

> **Épico 6 é predominantemente de Leonardo** (worker + coleta/sinalização + cifra + reengajamento), com **Sofia** na copy e **Alexandre/RT CREF** validando a política de sinalização/handoff. **Victor não é necessário no MVP** (não há ajuste automático de protocolo pelo check-in — isso é Fase 2). **Épico 7 é predominantemente de Felipe** (auth de conta única + fila + operações), com **Leonardo** nos endpoints/auditoria, **Sato** validando a segurança da primeira superfície autenticada e **Alexandre/RT CREF** validando a supervisão/assinatura/liberação PAR-Q — **o modelo jurídico "RT assina a metodologia + edita/assina/libera exceções per-usuário no painel" fecha aqui, e o painel é a única via de mudança concreta de treino no MVP**. **Henrique** liga SLA/observabilidade. Esta é a sprint que **fecha o MVP**.

## Critério de conclusão da Sprint 5 (aceite dos Épicos 6 + 7 e do MVP)

A Sprint 5 é **entregue** quando as 7 User Stories estiverem "validadas" conforme seus DoDs, o que na prática significa:

1. O **`CheckinWeeklyWorker`** dispara o check-in de 3 quick replies toda segunda 08–10h (America/Sao_Paulo), **idempotente** (`UNIQUE(user, protocol, week)`), só para pagantes, abrindo com vitória; **respostas cifradas** em repouso.
2. A **resposta do check-in é coletada, reconhecida e registrada** — **sem ajuste automático de protocolo no MVP**; pedido de ajuste/baixa aderência → **sinaliza o painel**; **dor anormal → handoff SAFETY**, nunca ajuste de carga.
3. **Inativos de 2 semanas** recebem um **nudge de retorno** sem julgamento (sem geração automática de protocolo).
4. O **profissional CREF (conta única) faz login autenticado** (RBAC mínimo, Argon2id, sessão segura) e acessa o dashboard sob RLS por role.
5. A **fila de supervisão** unifica `PENDING_REVIEW` + `handoff_alerts` (SAFETY/ALERT, incl. sinalizações de check-in) + `BLOCKED_PENDING_CLEARANCE`; o profissional **edita (validado pelo `ValidationService`), assina (login+timestamp+hash auditado) e libera** — incluindo a **liberação humana obrigatória das sessões PAR-Q de risco** (a dívida de 3 sprints, paga). O painel é a **única via de mudança concreta de treino no MVP**.
6. As **operações** entregam funil + alerta de SLA + replays de conversa **anonimizados**, atrás do login.
7. **Quality gate** bloqueante: idempotência, cifra das respostas, política do check-in (dor→handoff, sem ajuste automático), edição validada no painel, auth/RBAC, isolamento, liberação PAR-Q humana, anonimização, auditoria; integração dos fluxos verde.
8. CI verde; cobertura ≥80%; toda entrega via PR + 6 checks (`main` protegida); revisão de segurança de Sato + validação de Alexandre/RT CREF registradas. **O MVP está completo.**

### Pré-requisitos / bloqueadores a resolver no início da sprint

- **[Decisão de produto/jurídica — Alexandre/RT CREF] Política de sinalização/handoff do check-in** (US-5.2): quais respostas sinalizam o painel (pedido de ajuste, baixa aderência) e qual limiar de **dor/desconforto** força `handoff_alerts` (SAFETY). Aprovado pelo RT CREF antes do lançamento (dev roda com política-semente). **(O mapa feedback→ajuste automático é Fase 2 — não é pré-requisito do MVP, dada a decisão de não haver auto-ajuste.)**
- **[Decisão de produto/jurídica — Alexandre/RT CREF] Modelo de assinatura per-usuário e de liberação PAR-Q** (US-5.5): a Sprint 2 assinou a **metodologia**; a Sprint 5 adiciona a **edição/assinatura/liberação per-usuário** para as exceções, feita pelo profissional único. Confirmar formalmente o fluxo (o que o profissional assina, como libera, o que fica auditado). Não bloqueia dev; bloqueia o lançamento.
- **[Conteúdo — Sofia/Alexandre] Copy aprovada** do check-in (3 quick replies + abertura de vitória), do loop de reconhecimento, do nudge de reengajamento e das mensagens do painel — dentro dos guardrails.
- **[Segurança — Sato] Revisão da primeira superfície autenticada** (US-5.4): o painel é o primeiro login do produto; a auth/RBAC/isolamento precisa da revisão de Sato antes do merge.
- **[Escopo desta sprint — Leonardo/Alexandre] Cifra em repouso de `checkins.responses`** (dado de saúde Art. 11): **entra nesta sprint** (US-5.1.4, decisão do fundador) no mesmo padrão `pgcrypto`/`health-cipher` da anamnese — deixou de ser dívida pré-lançamento.
- **[Realidade de dev] Chaves reais/ZDR, conta AraraHQ e ratificação clínica do RT CREF são bloqueadores de LANÇAMENTO, não de dev** — a Sprint 5 roda com mocks/seeds (profissional-seed único, política-semente de sinalização). Explícito onde tocar.
- **[Marca] Go-live com usuário real permanece condicionado à liberação INPI (MOVIVO × VIVO)** — trava herdada. Construir e testar é liberado; entrega a usuário real depende do parecer de PI.

### Handoff para a Fase 6 (Infraestrutura) e além

Concluída a Sprint 5, **o MVP está funcionalmente completo**: aquisição → anamnese → protocolo supervisionado → conversa → conversão/pagamento → check-in/retenção → supervisão CREF. A Fase 6 (Henrique — DevOps/SRE) endurece a infraestrutura para o go-live (observabilidade completa, backup/DR, hardening, capacity). Os **bloqueadores de lançamento** acumulados nas 5 sprints (chaves reais/ZDR + DPAs OpenAI/Anthropic, conta AraraHQ, gateway de pagamento real, ratificação clínica do RT CREF de todo o conteúdo, parecer INPI MOVIVO×VIVO) devem ser resolvidos antes de cobrar/atender usuário real — nenhum deles bloqueou o desenvolvimento (rodou com mocks), mas todos bloqueiam o go-live. (A cifra de `checkins.responses`, antes listada aqui, foi **fechada dentro da Sprint 5** por decisão do fundador.) O critério "pronto para Fase 2" (Lucas §MVP: ≥100 pagantes, retenção 30d ≥75%, conversão ≥20%, NPS ≥50, SLA ≤2h em ≥95%) passa a ser medível com o produto completo em produção.

---

*Documento de planejamento operacional da Sprint 5 (última do MVP) — Lucas Monteiro (PM/PO). **Revisado para as decisões do fundador (2026-08-01): sem ajuste automático de protocolo no MVP (check-in coleta/reconhece/sinaliza; a mudança concreta vem do profissional no painel); cifra de `checkins.responses` nesta sprint; assinatura login+timestamp+hash de profissional único (conta única, RBAC mínimo); check-in só para assinantes; reengajamento em 2 semanas.** Escopo: Épico 6 (Check-in e Retenção) + Épico 7 (Operações/Dashboard CREF) de `08-relatorio-lucas.md`, juntos por dependência de fluxo (o check-in sinaliza o painel, que é a única via de mudança concreta de treino no MVP e paga a dívida de supervisão). Check-in de 3 quick replies e Dashboard de `09-relatorio-sofia.md` §11.5/§10. Supervisão CREF, liberação PAR-Q humana e assinatura de `06-relatorio-alexandre.md`. `ValidationService` reusado na edição do painel (`12-relatorio-victor.md`/Sprint 2); ajuste automático via gera-e-valida fica para a Fase 2. Auth/RBAC/isolamento/anonimização de `11-relatorio-sato.md` §9/§4. Dashboard Next.js+Socket.io e assinatura login+timestamp+hash de `10-relatorio-rafael.md`. Construído sobre a fundação das Sprints 0-4 (tabelas `checkins`/`handoff_alerts`/`protocols` já modeladas, fila `checkin-weekly` registrada, AuthModule/RBAC, geração+validador, outbound). **Esta sprint fecha o MVP e paga a dívida de supervisão CREF acumulada em 3 sprints.***

# Sprint 5 — Check-in Semanal e Dashboard de Supervisão CREF (MOVIVO)

**Autor:** Lucas Monteiro (Senior Product Manager / Product Owner — agente #08)
**Data:** 2026-08-01
**Ideia:** MOVIVO — AI Coach de treino no WhatsApp (`docs/fitness-ia-whatsapp/`)
**Fase do pipeline:** Fase 5 — Desenvolvimento (Sprint 5)
**Duração alvo:** 2 semanas (10 dias úteis) · 3 devs co-fundadores (Leonardo, Felipe, Henrique) + Engenheiro de IA (Victor, ajuste de protocolo) + QA (Mariana), com revisão de segurança de Sato e validação clínico-jurídica de Alexandre / RT CREF
**Documentos-fonte obrigatórios:** `docs/arquitetura/ARQUITETURA.md` (§6 filas, §8 janela de check-in / RLS, §10 roadmap, §12 regras inegociáveis) · `docs/fitness-ia-whatsapp/08-relatorio-lucas.md` (**Épico 6 — Check-in Semanal e Retenção**, **Épico 7 — Operações e Observabilidade**, North Star, aha moment, feedback loop) · `docs/fitness-ia-whatsapp/09-relatorio-sofia.md` (§11.5 check-in com 3 quick replies, loop visível, momento de vitória, §10 Dashboard CREF, §13 termos proibidos) · `docs/fitness-ia-whatsapp/06-relatorio-alexandre.md` (supervisão CREF, gate PAR-Q, liberação humana obrigatória, assinatura eletrônica, LGPD dado de saúde) · `docs/fitness-ia-whatsapp/12-relatorio-victor.md` (geração + ValidationService reusados no ajuste; faithfulness) · `docs/fitness-ia-whatsapp/11-relatorio-sato.md` (RLS/RBAC do painel, replays anonimizados, isolamento) · `docs/fitness-ia-whatsapp/10-relatorio-rafael.md` (Dashboard Next.js + Socket.io, assinatura login+timestamp+hash, versionamento de protocolo)

---

## Como ler este documento

Hierarquia: **Épicos → User Stories (US-5.x) → Tasks (TASK-5.x.y)**.

- Cada **User Story** declara: agentes participantes e ordem, dependências (depende de / habilita), jornada (o que se constrói e por quê), objetivo, resultado esperado, tasks e **Definição de Pronto (DoD)**.
- Cada **Task** declara: agente executor, instruções acionáveis e critério de conclusão objetivo.
- Uma User Story só é **ENTREGUE** quando **todas** as suas tasks estiverem finalizadas **E validadas** conforme o DoD (code review, teste automatizado verde, quality gate, revisão de segurança de Sato, validação clínico-jurídica de Alexandre / RT CREF).
- Esta é a **quinta e última sprint do MVP**. As Sprints 1-4 entregaram a porta de entrada (anamnese), o núcleo de valor (protocolo), o diálogo (AI Coach MOVI) e a monetização (conversão + pagamento). **A Sprint 5 fecha o ciclo de retenção e a supervisão humana** — as duas peças que faltam para o produto ser "coaching real" e legalmente defensável.

> **Decisão de escopo: dois épicos juntos (6 + 7), e por que são inseparáveis.** O fundador confirmou o par. A razão é uma dependência de fluxo, não uma coincidência de calendário: **o check-in gera novos protocolos ajustados**, e um ajuste que caia fora do escopo seguro (dor articular relatada, carga fora de faixa) **não pode ser auto-aplicado** — ele vira `PENDING_REVIEW` e precisa de um humano. Até agora **não existe humano nenhum no loop**: a Sprint 2 acumulou protocolos `PENDING_REVIEW`, a Sprint 3 acumulou `handoff_alerts` (níveis `ALERT`/`SAFETY`) e sessões `BLOCKED_PENDING_CLEARANCE` (PAR-Q de risco) — **três sprints de dívida de supervisão**, com um segmento de usuários (PAR-Q de risco) **permanentemente bloqueado** porque nunca houve tela para o profissional CREF liberá-los. O **Dashboard CREF é onde essa supervisão acumulada finalmente acontece** — e é pré-condição de compliance (a defensabilidade jurídica do produto perante o CREF, herdada de Clóvis/Alexandre). Construir o check-in **sem** o dashboard só aumentaria a dívida; construir o dashboard **sem** o check-in deixaria a retenção — a North Star — para depois. Por isso, juntos.

### Base já entregue pelas Sprints 0-4 (não reconstruir — consumir)

- **Geração por IA guiada + `ValidationService` (Sprint 2):** o **ajuste de protocolo do check-in reusa o modelo "gera-e-valida"** — a IA re-planeja sob a metodologia do RT e a base de referência a partir do feedback do check-in, o `ValidationService` **veta o treino inteiro inseguro**, e o resultado é uma **nova versão em `protocol_versions`**. Nenhum treino inseguro é aplicado. **Não se reimplementa** a geração nem o validador.
- **Tabela `checkins` já modelada (Sprint 0/1):** `weekNumber`, `responses` (JSONB — aderência/esforço/**dor**, dado sensível Art. 11), `adjustments`, `newProtocolId`, e o **`UNIQUE(user_id, protocol_id, week_number)` que torna o disparo semanal idempotente** (failover do scheduler não gera dois check-ins da mesma semana). A Sprint 5 preenche a lógica — não remodela.
- **Tabela `handoff_alerts` já modelada (US-3.6):** `level` (`ALERT` = revisão assíncrona sem promessa de retorno; `SAFETY` = red flag clínica, prioritário), `status` (`OPEN`…), `reason`, `conversationId`. Os docstrings já dizem que **"a UI, a notificação e a resolução humana são a Sprint 5, que lê esta tabela"** — é exatamente esta sprint.
- **`protocols` com `approval_status`/`human_review_required` e assinatura da metodologia do RT (US-2.4):** protocolos sem risco nascem `AUTO_APPROVED`; com risco → `PENDING_REVIEW`/`BLOCKED_PENDING_CLEARANCE`. A Sprint 5 constrói a **assinatura/edição/liberação per-usuário** que a Sprint 2 deixou explicitamente para cá.
- **Fila `checkin-weekly` já registrada (US-1.7):** `attempts: 3`, `backoffMs: [5s,15s,45s]`, `concurrency: 10`. A Sprint 5 preenche o `CheckinWeeklyWorker` — não reconstrói a fila.
- **Outbound WhatsApp + quick replies (US-2.5 / Sprint 3):** o check-in usa a fila `whatsapp-outbound` (bolhas, persona MOVI) e os **quick reply buttons** (máx 3, Sofia §11.5) já em uso na conversa.
- **AI Coach / contexto / intent (Sprint 3):** a intenção `CHECKIN_ANTECIPADO` já é **detectada** — a Sprint 5 liga o fluxo de ajuste que ela dispara; o handoff por dor anormal (guardrail de entrada) já grava `handoff_alerts` — a Sprint 5 dá a interface humana.
- **Assinatura/estado da assinatura (Sprint 4):** o check-in semanal é para **pagantes** (`ACTIVE`) — a North Star é "treinos concluídos por usuário **pago**". O gate de assinatura já existe.
- **AuthModule JWT RS256 + RBAC `USER`/`PROFESSIONAL`/`ADMIN` (Sprint 1):** o Dashboard CREF é **autenticado** (login do profissional com `password_hash` Argon2id — os únicos papéis que fazem login), ao contrário das telas de usuário do MVP (não-autenticadas por token, ADR-006). A Sprint 5 constrói a autenticação de sessão do painel (Auth.js/Next.js sobre o RBAC existente).
- **Isolamento por titular (RLS `FORCE ROW LEVEL SECURITY` + `SET LOCAL`):** estende-se ao check-in e às leituras do painel — a policy do `PROFESSIONAL`/`ADMIN` difere da do titular via `app.current_role` (Sato §4.3).

### Regras inegociáveis que valem nesta sprint (de `ARQUITETURA.md` §12, `06-alexandre`, `12-victor`, `11-sato`)

1. **O ajuste do check-in reusa gera-e-valida — nunca aplica treino inseguro** (Victor, Sprint 2): a IA re-planeja sob a metodologia do RT + base de referência a partir do feedback; o `ValidationService` veta o treino inteiro; sem risco → nova versão `AUTO_APPROVED` aplicada + loop visível; **com risco (dor articular, carga fora de faixa, exercício contraindicado) → `PENDING_REVIEW`, NÃO auto-aplicado**, roteado ao Dashboard CREF. A nota do schema `checkins.adjustments` que menciona "Motor Determinístico" fica **superada** pelo modelo gera-e-valida vigente.
2. **Disparo semanal idempotente** (schema): `CheckinWeeklyWorker` via BullMQ `repeat` na janela **segunda 08–10h America/Sao_Paulo**; o `UNIQUE(user_id, protocol_id, week_number)` garante que failover/reprocesso **não gera dois check-ins da mesma semana**.
3. **PAR-Q de risco só é liberado por humano** (Alexandre, BLOQUEADOR): sessões `BLOCKED_PENDING_CLEARANCE` **nunca** são auto-liberadas — a liberação é uma ação explícita do profissional CREF no painel. Esta sprint é a que finalmente dá essa ação.
4. **Dashboard CREF é autenticado** (RBAC `PROFESSIONAL`/`ADMIN`, `password_hash` Argon2id, sessão segura): diferente das telas de usuário por token. A policy RLS do profissional difere da do titular via `app.current_role`; o profissional vê apenas o que a sua policy permite.
5. **Assinatura eletrônica = login autenticado + timestamp + hash** (Rafael, não ICP-Brasil no MVP): toda liberação/edição/assinatura de protocolo pelo profissional registra `professional_id` + timestamp + `signature_hash` do conteúdo — trilha de auditoria imutável (`audit_logs` append-only da Sprint 1).
6. **Replays de conversa no painel são anonimizados** (Sato/LGPD): o PII Scrubber (US-2.2) roda sobre a conversa antes de exibi-la ao profissional — o painel serve para melhorar o sistema e supervisionar, não para expor PII em claro desnecessariamente.
7. **Guardrails de linguagem** em todo texto de check-in, loop visível, reengajamento e no painel (Sofia §13): nunca "diagnóstico"/"tratamento"/"cura"/"resultado garantido"; MOVI sempre ferramenta do profissional CREF; respaldo CREF visível.
8. **Dor/desconforto no check-in é dado de saúde** (schema, Art. 11): um relato de **dor anormal/articular** no check-in **dispara `handoff_alerts` (SAFETY)** e orienta o usuário a parar + procurar avaliação — nunca vira ajuste automático de carga.
9. **Loop de feedback visível** (Lucas/Sofia): o usuário que fez check-in **vê a mudança concreta** no protocolo da semana seguinte ("ajustei seu treino de quarta — reduzi a carga do agachamento") — é o que diferencia coaching real de pesquisa. A mudança comunicada reflete o ajuste realmente aplicado.
10. **Todo merge para `main`** passa por PR + os 6 checks verdes do CI; cobertura ≥80%; testes de idempotência do disparo, de ajuste-seguro (validador), de auth/RBAC do painel e de isolamento **bloqueantes**. Nenhum push direto.

---

# ÉPICO 6 — Check-in Semanal e Retenção · ÉPICO 7 — Supervisão CREF e Operações

### Descrição

Fechar o **ciclo de retenção** e a **supervisão humana** da MOVIVO. O check-in semanal (Épico 6) é o mecanismo que sustenta a **North Star (treinos concluídos por usuário pago/30 dias)** e transforma "informação" em "coaching real": toda segunda-feira MOVI pergunta como foi a semana em **3 quick replies** (semáforo de cansaço, treinos completados, pedido de ajuste), e o feedback **realimenta o protocolo** via gera-e-valida, com o **loop visível** de volta ao usuário. Inativos por 2 semanas recebem um **protocolo simplificado de retorno**. O Dashboard CREF (Épico 7) é onde a **supervisão humana acumulada de três sprints** finalmente acontece: o profissional CREF faz login autenticado e vê a **fila de supervisão** — protocolos `PENDING_REVIEW` (da Sprint 2 e agora dos ajustes de check-in), `handoff_alerts` (`ALERT`/`SAFETY`), sessões `BLOCKED_PENDING_CLEARANCE` (PAR-Q de risco) — e pode **editar, assinar e liberar** protocolos per-usuário, com trilha de auditoria (login+timestamp+hash). O painel também entrega **operações** — funil, alerta de SLA e replays de conversa anonimizados. Fecha com uma US de **QA + segurança** (idempotência, ajuste-seguro, auth/RBAC do painel, isolamento, replays anonimizados) como gate bloqueante.

### Objetivo

Ao final da Sprint 5: um usuário pagante recebe toda segunda-feira o check-in em 3 botões; ao responder, seu protocolo da semana seguinte é **ajustado com segurança** (gera-e-valida) e ele **vê a mudança**; se ficar inativo 2 semanas, recebe um caminho de retorno sem julgamento; um relato de dor anormal vira handoff, não ajuste de carga. E o profissional CREF, autenticado, **finalmente consegue** revisar/editar/assinar/liberar os protocolos `PENDING_REVIEW`, atender os `handoff_alerts` e **liberar as sessões PAR-Q de risco** que estavam bloqueadas — com auditoria, isolamento e replays anonimizados. O MVP fica completo e legalmente defensável.

### Resultado esperado dos épicos

- **`CheckinWeeklyWorker`** sobre `checkin-weekly`: disparo semanal (segunda 08–10h America/Sao_Paulo) via `repeat`, **idempotente** (`UNIQUE(user_id, protocol_id, week_number)`), só para pagantes (`ACTIVE`); 3 quick replies (Sofia §11.5); abre com vitória (positivity bias).
- **Ajuste de protocolo via gera-e-valida + loop visível:** a resposta do check-in realimenta a geração (nova versão em `protocol_versions`); sem risco → `AUTO_APPROVED` aplicado + mensagem de loop visível; com risco → `PENDING_REVIEW` (painel); dor anormal → `handoff_alerts` (SAFETY) + orientação de segurança.
- **Reengajamento de inativos:** 2 semanas sem resposta → mensagem sem julgamento + **protocolo simplificado de retorno**.
- **AuthModule do profissional + shell do dashboard:** login autenticado (Auth.js/Next.js sobre RBAC `PROFESSIONAL`/`ADMIN`, Argon2id), sessão segura, RLS por `app.current_role`.
- **Fila de supervisão + assinatura/edição/liberação:** lista de `PENDING_REVIEW` + `handoff_alerts` + `BLOCKED_PENDING_CLEARANCE`; o profissional edita/assina/libera protocolos e **libera as sessões PAR-Q** (ação humana obrigatória); trilha de auditoria login+timestamp+hash.
- **Operações:** funil (form→protocolo→primeiro treino→conversão), alerta de SLA, replays de conversa **anonimizados** (PII Scrubber); notificação real-time (Socket.io) de novos itens na fila.
- **Quality gate** bloqueante: idempotência do disparo, ajuste-seguro (validador veta), auth/RBAC do painel, isolamento por titular, replays anonimizados. Revisão de Sato + validação de Alexandre/RT CREF registradas.
- CI verde; cobertura ≥80%; toda entrega via PR + 6 checks.

### Não-escopo desta sprint (para não haver ambiguidade)

A fronteira da Sprint 5 é **"retenção + supervisão humana"** — fecha o MVP. Ficam **explicitamente fora** (Fase 2 do produto, Lucas §MVP):

- **App mobile nativo, dashboard/portal dedicado ao usuário final, wearables, gamificação (streaks/badges), referral automatizado, nutrition coaching, PIX recorrente, multi-idioma, API B2B.** O check-in e o painel do MVP são suficientes para validar retenção e supervisão; escalar cada um é Fase 2.
- **Assinatura eletrônica ICP-Brasil:** no MVP a assinatura é **login autenticado + timestamp + hash** (Rafael) — cobre o requisito de auditoria inicial. Certificado ICP-Brasil é Fase 2, se a escala/exigência regulatória pedir.
- **Ajuste de protocolo em tempo real fora do check-in (coaching avançado):** o usuário avançado pedir ajustes específicos via conversa a qualquer momento (Lucas Épico 6, US avançada) fica para Fase 2 — no MVP o ajuste estruturado acontece no ciclo do check-in; a conversa (Sprint 3) já responde dúvidas e substituições pontuais.
- **A/B test de timing do check-in (domingo à noite vs. segunda de manhã):** o MVP fixa segunda 08–10h (janela do schema/§8); o experimento de timing é otimização pós-tração.
- **Analytics avançado / cohort self-service / experimentação (Growth, Fase 8):** o painel de operações do MVP entrega o funil e o alerta de SLA; dashboards de growth sofisticados são fase posterior do pipeline.
- **Cifra em repouso de `checkins.responses`:** o schema nota que a resposta de dor é dado de saúde **não cifrado nesta sprint** (mesmo escopo da anamnese) — a cifra `pgcrypto` de `responses` é dívida conhecida a fechar antes do go-live com dado real (não bloqueia dev). **(Ver pergunta em aberto.)**

### Mapa de dependências entre User Stories

```
ÉPICO 6 — CHECK-IN
US-5.1 (CheckinWeeklyWorker: disparo semanal idempotente + 3 quick replies · Leonardo) ──────┐
US-5.2 (Resposta do check-in → ajuste via gera-e-valida + loop visível · Leonardo+Victor) ───┤
        └── depende de US-5.1 + REUSA geração+ValidationService (Sprint 2) + protocol_versions │
US-5.3 (Reengajamento de inativos + protocolo simplificado de retorno · Leonardo) ── dep 5.1/5.2

ÉPICO 7 — DASHBOARD CREF
US-5.4 (Auth do profissional + shell do dashboard · Felipe+Leonardo+Sato) ── REUSA AuthModule │
US-5.5 (Fila de supervisão + assinatura/edição/liberação · Felipe+Leonardo+Alexandre) ───────┤
        └── depende de US-5.4 + lê PENDING_REVIEW/handoff_alerts/BLOCKED + REUSA ValidationService
US-5.6 (Operações: funil + alerta SLA + replays anonimizados · Felipe+Henrique) ── dep US-5.4  │
US-5.7 (QA + segurança + AI eval do ajuste seguro · Mariana+Sato+Victor) ── valida US-5.1 a 5.6┘
```

**Interligação dos dois épicos:** o ajuste do check-in (US-5.2) que cai fora do escopo seguro vira `PENDING_REVIEW` e **entra na fila do painel (US-5.5)** — é o elo direto entre os dois épicos. O painel (Épico 7) é o destino da supervisão que o check-in (Épico 6) e as sprints anteriores produzem.

**Sequência prática recomendada (10 dias úteis):** **US-5.1 (worker de check-in) e US-5.4 (auth + shell do dashboard) começam no dia 1 em paralelo** — as duas fundações independentes (Leonardo no worker; Felipe/Leonardo no auth do painel, com Sato validando). US-5.2 (ajuste via gera-e-valida) dias 3-7, reusando a Sprint 2. US-5.5 (fila de supervisão + assinatura) dias 3-8, sobre o auth. US-5.3 (reengajamento) dias 6-8. US-5.6 (operações) dias 5-9. US-5.7 (QA + segurança) corre do dia 3 ao 10, fechando a sprint e o MVP.

---

## US-5.1 — CheckinWeeklyWorker: disparo semanal idempotente + 3 quick replies

**Agentes:** Leonardo (lead — worker, `repeat`, idempotência, quick replies) · Sofia (referência — formato/copy do check-in, momento de vitória) · Henrique (colabora — scheduler/timezone, observabilidade do disparo).
**Depende de:** fila `checkin-weekly` (US-1.7), outbound WhatsApp (US-2.5), assinatura `ACTIVE` (Sprint 4), tabela `checkins` (Sprint 0/1). É uma das **duas US que começam no dia 1**.
**Habilita:** US-5.2 (a resposta do check-in dispara o ajuste) e US-5.3 (inatividade se mede a partir do disparo/resposta).

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
Montar a mensagem de check-in (Sofia §11.5): abre com uma **vitória** concreta (treinos da semana anterior), depois **3 perguntas por quick reply** (semáforo de cansaço; treinos completados; pedido de ajuste). Copy nos guardrails, persona MOVI, respaldo CREF. Gravar as respostas (quick reply → `checkins.responses`). Emitir `checkin_sent`/`checkin_responded` (PostHog).
**Conclusão:** check-in com abertura positiva + 3 botões; respostas gravadas; eventos emitidos; copy aprovada nos guardrails.

### Definição de Pronto (US-5.1 "validada")

- [ ] Tasks 5.1.1–5.1.3 concluídas.
- [ ] Disparo semanal na janela de segunda (America/Sao_Paulo), idempotente por `UNIQUE(user, protocol, week)`, só para pagantes; 3 quick replies + abertura com vitória; respostas gravadas.
- [ ] **Validada por:** code review + revisão de copy (Sofia/guardrails) + teste de idempotência do disparo verde (US-5.7).

---

## US-5.2 — Resposta do check-in → ajuste de protocolo via gera-e-valida + loop visível

**Agentes:** Leonardo (lead — fluxo de ajuste, persistência de versão, loop visível) · Victor (colabora — realimenta a geração com o feedback, reusa o ValidationService) · Alexandre / RT CREF (validam que o ajuste automático respeita o escopo CREF-safe e o roteamento de risco).
**Depende de:** US-5.1 (a resposta), e **REUSA** a geração por IA + `ValidationService` (Sprint 2) e `protocol_versions`. Dias 3-7.
**Habilita:** US-5.5 (ajustes de risco viram `PENDING_REVIEW` na fila do painel) e a North Star (protocolo que evolui → treinos concluídos).

### Jornada

Este é o coração do "coaching real" (Lucas gap: feedback loop visível): a resposta do check-in **realimenta o protocolo**, e o usuário **vê a mudança**. Leonardo + Victor reusam o pipeline gera-e-valida da Sprint 2: as respostas (cansaço/treinos/pedido de ajuste) entram como **novas constraints de feedback** na geração — a IA re-planeja a semana seguinte sob a metodologia do RT e a base de referência (ex.: cansaço 🔴 + poucos treinos → reduzir volume; pedido "mais desafio" + cansaço 🟢 → progressão de carga), e o **`ValidationService` veta o treino inteiro inseguro**. O resultado é uma **nova versão em `protocol_versions`** (`newProtocolId` no check-in). **Roteamento por risco (a regra crítica):** ajuste limpo → nova versão `AUTO_APPROVED` aplicada + **mensagem de loop visível** ("com base no seu feedback, ajustei seu treino de quarta — reduzi a carga do agachamento e adicionei mobilidade"); ajuste que o validador bloqueia ou que envolve **dor articular/anormal** → **NÃO auto-aplica**: vira `PENDING_REVIEW` (fila do painel, US-5.5) e/ou `handoff_alerts` (SAFETY) + orientação de segurança ao usuário (parar + procurar avaliação). A nota do schema sobre "Motor Determinístico" fica superada — o ajuste é gera-e-valida. Alexandre/RT CREF validam o mapa feedback→ajuste e o limiar de risco que dispara revisão humana.

### Objetivo

Ter a resposta do check-in realimentando a geração (gera-e-valida) para produzir uma nova versão de protocolo segura, aplicada automaticamente quando limpa (com loop visível) e roteada ao painel/handoff quando há risco.

### Resultado esperado

Um check-in com cansaço alto reduz o volume da semana seguinte e o usuário recebe a mensagem de loop visível; um pedido de mais desafio com boa recuperação progride a carga; um relato de dor articular **não** vira ajuste de carga — vira handoff + orientação de parar; um ajuste que o validador bloqueia fica `PENDING_REVIEW` sem ser aplicado; toda mudança gera uma nova `protocol_versions`.

### Tasks

**TASK-5.2.1 — Realimentar a geração com o feedback do check-in (Leonardo + Victor).**
Mapear as respostas do check-in (cansaço/treinos/pedido) em **constraints de feedback** que entram na geração (reusa a geração da Sprint 2 via PII Scrubber + LLMRouter): a IA re-planeja a semana seguinte sob a metodologia do RT + base de referência. Alexandre/RT CREF validam o mapa feedback→ajuste (ex.: 🔴 + <2 treinos → reduzir volume; "mais desafio" + 🟢 → progredir). Registrar `adjustments` no check-in.
**Conclusão:** feedback vira constraints; geração re-planeja a semana; `adjustments` gravado; mapa validado pelo RT CREF por escrito.

**TASK-5.2.2 — Validação do ajuste (reusa ValidationService) + roteamento por risco (Leonardo + Victor + Alexandre).**
Rodar o **`ValidationService` (Sprint 2)** sobre o protocolo ajustado — veta o treino inteiro inseguro. Roteamento: limpo → nova versão `AUTO_APPROVED` aplicada (`newProtocolId`, `protocol_versions`); bloqueado pelo validador → `PENDING_REVIEW` (fila do painel, US-5.5), **não aplicado**; **dor articular/anormal na resposta → `handoff_alerts` (SAFETY)** + orientação de segurança, **nunca ajuste de carga automático**. Sob RLS.
**Conclusão:** ajuste limpo aplicado como nova versão; ajuste inseguro fica `PENDING_REVIEW` sem aplicar; dor anormal vira handoff SAFETY; validador reusado (não reimplementado).

**TASK-5.2.3 — Loop de feedback visível ao usuário (Leonardo + Sofia ref.).**
Quando o ajuste limpo é aplicado, enviar a **mensagem de loop visível** (Lucas/Sofia): comunica a mudança concreta que reflete o `adjustments` realmente aplicado ("ajustei seu treino de quarta — reduzi a carga do agachamento"). Copy nos guardrails, persona MOVI. Emitir `protocol_adjusted` (PostHog).
**Conclusão:** usuário recebe a mudança concreta correspondente ao ajuste aplicado; copy nos guardrails; evento emitido.

### Definição de Pronto (US-5.2 "validada")

- [ ] Tasks 5.2.1–5.2.3 concluídas.
- [ ] Feedback do check-in realimenta gera-e-valida → nova versão segura; limpo → aplicado + loop visível; inseguro → `PENDING_REVIEW` sem aplicar; dor anormal → handoff SAFETY; validador reusado.
- [ ] **Validada por:** code review + **aprovação do RT CREF / Alexandre** (mapa feedback→ajuste, limiar de risco) + AI eval de ajuste-seguro (Mariana/Victor) verde (US-5.7).

---

## US-5.3 — Reengajamento de inativos + protocolo simplificado de retorno

**Agentes:** Leonardo (lead — detecção de inatividade, fluxo de retorno) · Sofia (referência — tom sem julgamento) · Victor (colabora — protocolo simplificado via geração).
**Depende de:** US-5.1/US-5.2 (inatividade se mede a partir do ciclo de check-in). Dias 6-8.
**Habilita:** recuperação de churn silencioso (Lucas Épico 6, gap 4 de reengajamento).

### Jornada

Lucas marcou a ausência de reengajamento como um gap destruidor de LTV: **o que acontece se o usuário some?** (Épico 6). Leonardo implementa a detecção de inatividade — **2 semanas sem responder o check-in** (ou sem treino auto-reportado) — que dispara um fluxo de win-back **sem julgamento** (Sofia): uma mensagem acolhedora que ajuda a identificar o que aconteceu e oferece um **protocolo simplificado de retorno** (menos volume, mais fácil de retomar — gerado via gera-e-valida com constraint de "retorno"), para o usuário voltar a treinar sem se sentir sobrecarregado. É a diferença entre perder o usuário em silêncio e dar um caminho de volta digno. Copy nos guardrails, persona MOVI; nunca cobrança ou culpa.

### Objetivo

Ter a detecção de inatividade (2 semanas sem check-in/treino) disparando uma mensagem sem julgamento + um protocolo simplificado de retorno gerado com segurança.

### Resultado esperado

Um usuário 2 semanas sem responder recebe uma mensagem acolhedora e a oferta de um protocolo de retorno mais leve; quem retoma recebe o protocolo simplificado (validado); a copy não julga nem cobra.

### Tasks

**TASK-5.3.1 — Detecção de inatividade + mensagem sem julgamento (Leonardo + Sofia ref.).**
Detectar 2 semanas sem resposta de check-in (ou sem treino reportado) e disparar a mensagem de reengajamento sem julgamento (Sofia): acolhe, ajuda a identificar o obstáculo, oferece o retorno. Idempotente (não repetir a cada job). Emitir `reengagement_sent`/`reengagement_responded` (PostHog).
**Conclusão:** inatividade de 2 semanas dispara a mensagem uma vez; copy sem julgamento nos guardrails; eventos emitidos.

**TASK-5.3.2 — Protocolo simplificado de retorno (Leonardo + Victor).**
Gerar, via gera-e-valida (reusa Sprint 2) com constraint de "retorno" (menor volume/intensidade), um protocolo simplificado — validado pelo `ValidationService` como qualquer outro; se risco → `PENDING_REVIEW`. Aplicar quando o usuário aceita retomar; nova versão em `protocol_versions`.
**Conclusão:** protocolo de retorno gerado e validado; aplicado ao retomar; risco roteado ao painel.

### Definição de Pronto (US-5.3 "validada")

- [ ] Tasks 5.3.1–5.3.2 concluídas.
- [ ] Inatividade de 2 semanas dispara reengajamento sem julgamento + protocolo simplificado de retorno (validado); idempotente.
- [ ] **Validada por:** code review + revisão de copy (Sofia/guardrails) + teste de detecção/idempotência verde (US-5.7).

---

## US-5.4 — Autenticação do profissional + shell do Dashboard CREF

**Agentes:** Felipe (lead — Auth.js/Next.js, shell do dashboard) · Leonardo (colabora — endpoints autenticados, RLS por `app.current_role`) · Sato (valida auth/sessão/RBAC do painel — §9).
**Depende de:** AuthModule JWT RS256 + RBAC `PROFESSIONAL`/`ADMIN` (Sprint 1). É uma das **duas US que começam no dia 1**.
**Habilita:** US-5.5 (fila de supervisão) e US-5.6 (operações) — ambas vivem atrás do login.

### Jornada

O Dashboard CREF é a **primeira superfície autenticada do produto** (Rafael/Sato §9.2): diferente das telas de usuário do MVP (não-autenticadas, por token opaco, ADR-006), o painel exige **login do profissional** — `PROFESSIONAL` e `ADMIN` são os únicos papéis com `password_hash` (Argon2id, US-1.4). Felipe constrói a autenticação de sessão (Auth.js/Next.js sobre o RBAC/JWT existente) e o **shell do dashboard** (layout, navegação, guarda de rota por papel) sobre o design system "O Pulso". Leonardo expõe os endpoints autenticados sob **RLS com `app.current_role`** — a policy do profissional difere da do titular (Sato §4.3): o profissional vê a fila de supervisão que sua policy permite, não pode ler dado fora do seu escopo. Sato valida a auth (sessão segura, httpOnly, rotation, `alg` fixo — T-09), o RBAC e a proteção contra escalonamento. Em dev, um profissional-seed com `password_hash` de teste.

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
**Depende de:** US-5.4 (auth/shell), e lê `PENDING_REVIEW` (US-2.4 + US-5.2), `handoff_alerts` (US-3.6), `BLOCKED_PENDING_CLEARANCE` (US-2.4); **REUSA** o `ValidationService` para validar edições manuais. Dias 3-8.
**Habilita:** a defensabilidade jurídica do MVP — a supervisão CREF acontecendo de fato.

### Jornada

Esta é a US que **paga a dívida de supervisão de três sprints**. O profissional CREF, autenticado (US-5.4), vê uma **fila de supervisão** unificada com três origens: **(1) protocolos `PENDING_REVIEW`** — os que o validador flagou na Sprint 2 e agora os ajustes de check-in de risco (US-5.2); **(2) `handoff_alerts`** — `SAFETY` (red flag clínica, prioritário) no topo, `ALERT` (revisão assíncrona) abaixo, ordenados por nível/tempo (o índice `idx_handoff_alerts_queue` do schema); **(3) sessões `BLOCKED_PENDING_CLEARANCE`** — PAR-Q de risco que **nunca foram liberadas** porque não havia tela. O profissional pode: **revisar** o protocolo/contexto (com o replay de conversa anonimizado, US-5.6), **editar** o protocolo manualmente (a edição passa pelo `ValidationService` — nem o humano aplica treino que o validador reprova sem override consciente), **assinar** (login+timestamp+`signature_hash`, trilha em `audit_logs` append-only), e **liberar** — incluindo a **liberação humana obrigatória das sessões PAR-Q de risco** (Alexandre, BLOQUEADOR): essa é a ação que desbloqueia o segmento que estava preso. Marcar `handoff_alerts.status` resolvido. Alexandre/RT CREF validam o fluxo, a assinatura e o modelo de liberação.

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

## US-5.7 — QA, segurança e avaliação do ajuste seguro (fecha o MVP)

**Agentes:** Mariana (lead — testes, cobertura, quality gates) · Sato (revisão de segurança: auth/RBAC do painel, isolamento, anonimização, liberação PAR-Q) · Victor (AI eval do ajuste seguro do check-in).
**Depende de:** US-5.1 a US-5.6 (há o que testar). **Alimenta** o CI (quality gate). **Fecha o MVP.**
**Habilita:** a entrada segura da Sprint 5 em `main` e o critério de "pronto para Fase 2" (Lucas §MVP).

### Jornada

A Sprint 5 fecha o MVP — e junta os dois riscos mais sensíveis do produto: **ajuste automático de treino sobre dado de saúde** (o check-in muda o protocolo) e **a primeira superfície autenticada** (o painel do profissional, que pode editar/liberar protocolos de qualquer usuário). Mariana constrói a suíte como **quality gate bloqueante**: **idempotência do disparo** (failover não duplica check-in), **ajuste-seguro** (o `ValidationService` veta o ajuste inseguro; dor anormal vira handoff, não carga), **auth/RBAC do painel** (não-profissional barrado; sessão segura; sem escalonamento), **isolamento por titular** (o profissional lê sob policy; nenhum vazamento cross-tenant; nenhum endpoint aceita `user_id` do cliente), **liberação PAR-Q humana** (sessão bloqueada nunca auto-libera), **anonimização dos replays** (0 PII em claro), e **auditoria** (assinatura registra profissional+timestamp+hash). Victor mede o **faithfulness do ajuste** (o protocolo ajustado segue a metodologia/base e o feedback, sem inventar exercício). Sato registra a revisão de segurança consolidada do painel. Fecha confirmando o critério de "pronto para Fase 2" (Lucas): retenção 30d, conversão, SLA.

### Objetivo

Cobertura ≥80% do código novo, suíte bloqueante (idempotência, ajuste-seguro, auth/RBAC, isolamento, liberação PAR-Q, anonimização, auditoria), AI eval do ajuste, e revisão de Sato + validação de Alexandre/RT CREF — tudo no CI, fechando o MVP.

### Resultado esperado

O CI reprova qualquer PR que: duplique o check-in num failover, aplique um ajuste que o validador reprova, deixe dor anormal virar ajuste de carga, permita não-profissional acessar o painel, quebre o isolamento por titular, auto-libere uma sessão PAR-Q, exponha PII num replay, ou derrube a cobertura abaixo de 80%; os fluxos (check-in→ajuste→loop, reengajamento, fila→edição→assinatura→liberação) têm teste de integração verde; as revisões de Sato e Alexandre/RT CREF estão anexadas.

### Tasks

**TASK-5.7.1 — Idempotência + ajuste-seguro do check-in (bloqueante) (Mariana + Victor).**
Testes: idempotência do disparo (`UNIQUE(user, protocol, week)` — failover não duplica); ajuste-seguro (validador veta ajuste inseguro → `PENDING_REVIEW`, não aplica; dor anormal → handoff SAFETY, não carga); **AI eval de faithfulness do ajuste** (segue metodologia/base + feedback, não inventa). **Gates bloqueantes.**
**Conclusão:** disparo duplicado plantado falha; ajuste inseguro/dor-anormal plantado não é aplicado; faithfulness do ajuste no CI.

**TASK-5.7.2 — Auth/RBAC do painel + isolamento + liberação PAR-Q (Mariana + Sato).**
Testes: auth do painel (não-profissional barrado; sessão segura; sem escalonamento — T-09); **isolamento por titular** (profissional lê sob policy; sem vazamento cross-tenant; nenhum endpoint aceita `user_id` do cliente); **liberação PAR-Q humana** (sessão `BLOCKED_PENDING_CLEARANCE` nunca auto-libera). Isolamento e liberação bloqueantes.
**Conclusão:** não-profissional barrado; vazamento cross-tenant falha o pipeline; auto-liberação de PAR-Q falha o pipeline.

**TASK-5.7.3 — Anonimização, auditoria e integração ponta a ponta (Mariana + Sato + Leonardo).**
Testes: replays sem PII em claro (PII Scrubber); auditoria de assinatura (profissional+timestamp+hash em `audit_logs` append-only). Integração: check-in→ajuste→loop visível; ajuste-de-risco→`PENDING_REVIEW`; reengajamento; fila→edição validada→assinatura→liberação PAR-Q.
**Conclusão:** 0 PII nos replays; auditoria registrada; integração dos fluxos verde local e no CI.

**TASK-5.7.4 — Revisão de segurança de Sato + validação clínico-jurídica + fecho de MVP (Mariana + Sato + Alexandre/RT CREF).**
Sato registra a **revisão de segurança consolidada do painel** (auth, RBAC, isolamento, anonimização, auditoria). Alexandre/RT CREF validam o fluxo de supervisão/assinatura/liberação PAR-Q. Confirmar o critério "pronto para Fase 2" (Lucas §MVP): retenção 30d, conversão, SLA, NPS instrumentados.
**Conclusão:** revisão de Sato registrada; Alexandre/RT CREF validam; critério de Fase 2 instrumentado.

### Definição de Pronto (US-5.7 "validada")

- [ ] Tasks 5.7.1–5.7.4 concluídas.
- [ ] Idempotência, ajuste-seguro, auth/RBAC, isolamento, liberação PAR-Q humana, anonimização e auditoria bloqueantes; integração dos fluxos verde; AI eval do ajuste ok.
- [ ] Cobertura ≥80%; gates integrados ao CI.
- [ ] **Validada por:** review de Mariana + **revisão de segurança de Sato registrada** + **validação de Alexandre / RT CREF** + CI verde.

---

## Matriz de responsabilidade por User Story (RACI simplificado)

| US | Título | Responsável (R) | Colabora (C) | Valida (V) |
|---|---|---|---|---|
| US-5.1 | CheckinWeeklyWorker: disparo semanal idempotente + 3 quick replies | **Leonardo** | Sofia (formato), Henrique (scheduler/tz) | Review + copy + idempotência (Mariana) |
| US-5.2 | Resposta do check-in → ajuste via gera-e-valida + loop visível | **Leonardo** | Victor (geração/validador) | **Alexandre / RT CREF** (mapa/risco) + AI eval (Mariana) |
| US-5.3 | Reengajamento de inativos + protocolo de retorno | **Leonardo** | Victor (protocolo simplificado), Sofia (tom) | Review + copy + Mariana |
| US-5.4 | Auth do profissional + shell do dashboard | **Felipe** | Leonardo (endpoints/RLS), Sato (segurança) | **Sato (auth/RBAC — §9)** + Mariana |
| US-5.5 | Fila de supervisão + assinatura/edição/liberação | **Felipe** | Leonardo (endpoints/auditoria) | **Alexandre / RT CREF** (supervisão/liberação) + Sato + Mariana |
| US-5.6 | Operações: funil + alerta SLA + replays anonimizados | **Felipe** | Henrique (SLA/obs.), Sato (anonimização) | **Sato (anonimização/LGPD)** + Mariana |
| US-5.7 | QA + segurança + AI eval do ajuste seguro | **Mariana** | Sato, Victor, Leonardo | Mariana + **Sato** + **Alexandre / RT CREF** + gate no CI |

> **Épico 6 é predominantemente de Leonardo** (worker + ajuste + reengajamento), com **Victor** colaborando no ajuste (reuso da geração/validador) e **Alexandre/RT CREF** validando o mapa feedback→ajuste e o limiar de risco. **Épico 7 é predominantemente de Felipe** (auth + fila + operações), com **Leonardo** nos endpoints/auditoria, **Sato** validando a segurança da primeira superfície autenticada e **Alexandre/RT CREF** validando a supervisão/assinatura/liberação PAR-Q — **o modelo jurídico "RT assina a metodologia + libera exceções per-usuário" fecha aqui**. **Henrique** liga SLA/observabilidade. Esta é a sprint que **fecha o MVP**.

## Critério de conclusão da Sprint 5 (aceite dos Épicos 6 + 7 e do MVP)

A Sprint 5 é **entregue** quando as 7 User Stories estiverem "validadas" conforme seus DoDs, o que na prática significa:

1. O **`CheckinWeeklyWorker`** dispara o check-in de 3 quick replies toda segunda 08–10h (America/Sao_Paulo), **idempotente** (`UNIQUE(user, protocol, week)`), só para pagantes, abrindo com vitória.
2. A **resposta do check-in realimenta gera-e-valida** → nova versão segura; limpo → aplicado + **loop visível**; inseguro → `PENDING_REVIEW`; **dor anormal → handoff SAFETY**, nunca ajuste de carga.
3. **Inativos de 2 semanas** recebem reengajamento sem julgamento + protocolo simplificado de retorno.
4. O **profissional CREF faz login autenticado** (RBAC, Argon2id, sessão segura) e acessa o dashboard sob RLS por role.
5. A **fila de supervisão** unifica `PENDING_REVIEW` + `handoff_alerts` (SAFETY/ALERT) + `BLOCKED_PENDING_CLEARANCE`; o profissional **edita (validado), assina (login+timestamp+hash auditado) e libera** — incluindo a **liberação humana obrigatória das sessões PAR-Q de risco** (a dívida de 3 sprints, paga).
6. As **operações** entregam funil + alerta de SLA + replays de conversa **anonimizados**, atrás do login.
7. **Quality gate** bloqueante: idempotência, ajuste-seguro, auth/RBAC, isolamento, liberação PAR-Q humana, anonimização, auditoria; AI eval do ajuste; integração dos fluxos verde.
8. CI verde; cobertura ≥80%; toda entrega via PR + 6 checks (`main` protegida); revisão de segurança de Sato + validação de Alexandre/RT CREF registradas. **O MVP está completo.**

### Pré-requisitos / bloqueadores a resolver no início da sprint

- **[Conteúdo clínico — RT CREF/Victor] Mapa feedback→ajuste + limiar de risco que dispara revisão humana** (US-5.2): é insumo clínico. Como cada resposta de check-in (cansaço/treinos/pedido) se traduz em ajuste, e qual limiar (ex.: dor articular, salto de carga) força `PENDING_REVIEW`/handoff em vez de auto-aplicar. Aprovado pelo RT CREF antes do lançamento (dev roda com mapa-semente).
- **[Decisão de produto/jurídica — Alexandre/RT CREF] Modelo de assinatura per-usuário e de liberação PAR-Q** (US-5.5): a Sprint 2 assinou a **metodologia**; a Sprint 5 adiciona a **assinatura/liberação per-usuário** para as exceções. Confirmar formalmente o fluxo (o que o profissional assina, como libera, o que fica auditado). Não bloqueia dev; bloqueia o lançamento.
- **[Conteúdo — Sofia/Alexandre] Copy aprovada** do check-in (3 quick replies + abertura de vitória), do loop visível, do reengajamento e das mensagens do painel — dentro dos guardrails.
- **[Segurança — Sato] Revisão da primeira superfície autenticada** (US-5.4): o painel é o primeiro login do produto; a auth/RBAC/isolamento precisa da revisão de Sato antes do merge.
- **[Dívida conhecida — Leonardo/Alexandre] Cifra em repouso de `checkins.responses`** (dado de saúde Art. 11, hoje não cifrado por decisão de escopo): fechar antes do go-live com dado real, no mesmo padrão `pgcrypto` da anamnese. Não bloqueia dev.
- **[Realidade de dev] Chaves reais/ZDR, conta AraraHQ e ratificação clínica do RT CREF são bloqueadores de LANÇAMENTO, não de dev** — a Sprint 5 roda com mocks/seeds (profissional-seed, mapa-semente de ajuste). Explícito onde tocar.
- **[Marca] Go-live com usuário real permanece condicionado à liberação INPI (MOVIVO × VIVO)** — trava herdada. Construir e testar é liberado; entrega a usuário real depende do parecer de PI.

### Handoff para a Fase 6 (Infraestrutura) e além

Concluída a Sprint 5, **o MVP está funcionalmente completo**: aquisição → anamnese → protocolo supervisionado → conversa → conversão/pagamento → check-in/retenção → supervisão CREF. A Fase 6 (Henrique — DevOps/SRE) endurece a infraestrutura para o go-live (observabilidade completa, backup/DR, hardening, capacity). Os **bloqueadores de lançamento** acumulados nas 5 sprints (chaves reais/ZDR + DPAs OpenAI/Anthropic, conta AraraHQ, gateway de pagamento real, cifra de `checkins.responses`, ratificação clínica do RT CREF de todo o conteúdo, parecer INPI MOVIVO×VIVO) devem ser resolvidos antes de cobrar/atender usuário real — nenhum deles bloqueou o desenvolvimento (rodou com mocks), mas todos bloqueiam o go-live. O critério "pronto para Fase 2" (Lucas §MVP: ≥100 pagantes, retenção 30d ≥75%, conversão ≥20%, NPS ≥50, SLA ≤2h em ≥95%) passa a ser medível com o produto completo em produção.

---

*Documento de planejamento operacional da Sprint 5 (última do MVP) — Lucas Monteiro (PM/PO). Escopo: Épico 6 (Check-in e Retenção) + Épico 7 (Operações/Dashboard CREF) de `08-relatorio-lucas.md`, juntos por dependência de fluxo (o ajuste do check-in gera `PENDING_REVIEW` que só o painel resolve). Check-in de 3 quick replies, loop visível e Dashboard de `09-relatorio-sofia.md` §11.5/§10. Supervisão CREF, liberação PAR-Q humana e assinatura de `06-relatorio-alexandre.md`. Ajuste reusa gera-e-valida de `12-relatorio-victor.md`/Sprint 2. Auth/RBAC/isolamento/anonimização de `11-relatorio-sato.md` §9/§4. Dashboard Next.js+Socket.io e assinatura login+timestamp+hash de `10-relatorio-rafael.md`. Construído sobre a fundação das Sprints 0-4 (tabelas `checkins`/`handoff_alerts`/`protocols` já modeladas, fila `checkin-weekly` registrada, AuthModule/RBAC, geração+validador, outbound). **Esta sprint fecha o MVP e paga a dívida de supervisão CREF acumulada em 3 sprints.***

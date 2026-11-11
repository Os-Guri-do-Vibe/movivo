# MOVIVO 2.0 — documentação do produto e do código

Documento único para quem continua o desenvolvimento (pessoa ou agente de IA). Explica o que a MOVIVO 2.0 é, como funciona, o que já existe, como e por que foi feito, e o que falta.

- Branch de trabalho: `movivo-app-v2`. Produção só recebe deploy no push para `main` (PR de integração ainda em rascunho).
- Setup, comandos e infraestrutura detalhados: [README.md](README.md).
- Documentos de planejamento originais (inventário, especificação, plano M0–M11, relatórios de entrega): fora do repositório, em `movivo-docs/v2/` (`01-inventario.md`, `02-especificacao.md`, `03-plano-de-entregas.md`, `PROGRESSO.md`, `entregas/`).

---

## 1. O que é a MOVIVO 2.0

Assessoria de movimento, performance e bem-estar entregue pelo **WhatsApp**. Princípio: _a MOVIVO assume a complexidade, o aluno recebe clareza._

- **Plano integrado**: treino (musculação, corrida, HYROX, híbrido, esporte externo) e alimentação num único protocolo coerente, ajustado continuamente.
- **IA como ferramenta, profissional como responsável**: agentes de IA montam e ajustam o plano **dentro de políticas e de uma metodologia escritas e publicadas pelos profissionais** (CREF treino, CRN nutrição, CRM saúde). O modelo nunca escreve no banco: devolve uma **proposta tipada**; o código valida, decide e executa.
- **Profissional por exceção**: a equipe só atua quando há sinal de segurança, situação sem política aplicável, plano que a autonomia manda revisar, exame com ponto de atenção ou pedido de revisão humana do aluno (LGPD art. 20).
- **Sem app e sem login para o aluno**: tudo acontece no WhatsApp e em **links mágicos** (plano, treino do dia, alimentação, check-in, conta, relatório).
- **LGPD e segurança**: dado de saúde cifrado em repouso, RLS por titular no Postgres, consentimentos versionados e revogáveis, guardrails de linguagem (nunca "diagnóstico", "tratamento", "cura" ou "resultado garantido").

Diferença para a v1: a v1 entregava protocolos de força e um chat; a v2 é um motor integrado de treino + nutrição com decisões automáticas dentro de políticas versionadas, fila por exceção e conselho de agentes.

---

## 2. Como funciona

### 2.1 Jornada do aluno

1. **Anamnese** (link, sem login, 8 blocos): cadastro; objetivo e prova; modalidades, experiência e equipamento; rotina e janelas; preferências e barreiras; saúde (dores, medicamentos, alergias, **PAR-Q**); alimentação; medidas (fotos opcionais com consentimento próprio). Alunos antigos recebem a **anamnese complementar** (pré-preenchida, só o que falta).
2. **Consentimentos** (`packages/shared/src/schemas/consent.schema.ts`): Termos, dados de saúde (art. 11 LGPD), ciência do uso de IA, marketing (opcional), fotos do corpo (opcional) e ciclo menstrual (opcional, pelo WhatsApp). PAR-Q positivo gera **sinal de segurança** e caso na fila; o plano só é gerado depois que o profissional resolve.
3. **Geração do plano** (automática, fila `plan-generation`): estratégia do objetivo → blocos por modalidade → planejador híbrido → nutrição (cálculos determinísticos, modelo escolhe dentro dos limites) → **coordenador** revisa a coerência → validadores de domínio → motor de políticas. Conforme a autonomia publicada, o plano é publicado direto ou vai para revisão do profissional.
4. **Entrega**: mensagem no WhatsApp com link da página do plano + **PDFs de treino e alimentação** + (na primeira entrega) convite para o grupo **MOVIVO CLUB**.
5. **Dia a dia**: link do treino do dia (04:00 no fuso do aluno); registro de séries, carga, RIR, ritmo, FC; importação de `.fit`/`.gpx`, print do relógio (visão) ou **Strava automático**; registro alimentar por texto ou foto (rascunho confirmado pelo aluno).
6. **Conversa no WhatsApp**: sentinela de segurança → classificação de intenção (indisponibilidade, pouco tempo, troca de exercício, refeição, dúvida, dor, revisão humana…) → proposta → motor de políticas → executar / perguntar / escalar / bloquear. Comandos determinísticos (sem modelo): revogar consentimento, assinatura, ciclo menstrual, Strava. Anexo de **exame** (PDF/foto) vai para a Medicina. Quem conversa com o aluno é uma **persona** de IA: Mariana para o público feminino e Leonardo para o masculino (ver 5, "Personas da comunicação").
7. **Check-in adaptativo** (domingo): poucas perguntas escolhidas por sinais reais.
8. **Revisão semanal** (segunda): código mede adesão, carga, dor, peso e check-in. Sem sinal, o modelo não é chamado. Com sinal, os **analistas de Recuperação e Hábitos** leem a semana e a revisão propõe até 2 ações (sempre pelo motor de políticas).
9. **Relatório mensal** (1ª segunda do mês): PDF + resumo no WhatsApp, com **previsão de prova** para quem corre.
10. **Assinatura**: Asaas (mensal/trimestral/semestral/anual), portal do aluno por link.

### 2.2 Lado da equipe (painel `apps/web`, `/dashboard`)

- **Fila de exceções** (`/dashboard/fila`): cada profissional vê só o domínio do seu conselho (CREF treino, CRN nutrição, CRM médico; ADMIN lê tudo). No caso: proposta, justificativa, hipóteses, incerteza, Estado do Aluno; ações assumir / aprovar / recusar / encerrar.
  - **Revisão de protocolo**: ver o plano completo e a semana simulada, **editar à mão** (exercício, séries, reps, carga, descanso, RIR; metas e refeições da nutrição), ou **pedir ajuste aos agentes** por texto.
  - **Exame enviado**: valores lidos, comentário enviado ao aluno, especialidade sugerida e arquivo original.
- **Estúdio de metodologia** (`/dashboard/ia/metodologia`): 10 documentos (Força, Corrida, HYROX, Híbrido, Nutrição, Recuperação, Adesão, Segurança, Autonomia, Comunicação) com campos parametrizados; ciclo DRAFT → TESTING (roda avaliação) → PUBLISHED.
- **Autonomia** (documento AUTONOMY): por tipo de ação, AUTO / AUTO_COM_LIMITES / PERGUNTAR / ESCALAR / BLOQUEAR.
- **Agentes** (`/dashboard/ia/agentes`) e **Fichas dos agentes** (`/dashboard/ia/fichas`): modelo por tier editável sem deploy, custo por tarefa, e a ficha (markdown) de cada agente — só ADMIN edita; só publica depois de passar nos casos de avaliação.
- **Ficha do aluno**: estado, plano, adesão, check-ins, execuções, casos, decisões e a seção **Acompanhamento** (leitura dos analistas).

---

## 3. Arquitetura

Monorepo pnpm + Turborepo:

| Pacote            | Stack                                                                  | Papel                                                                                                          |
| ----------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `apps/api`        | NestJS, Drizzle, Postgres 17 (RLS FORCE), Redis + BullMQ, pino, pdfkit | Domínio, agentes, filas, WhatsApp (EvolutionAPI), pagamentos (Asaas)                                           |
| `apps/web`        | Next.js, React, Tailwind                                               | Páginas do aluno (links mágicos) e painel; BFF em `/api/dashboard/control/[...path]` com allowlist de POST/PUT |
| `packages/shared` | Zod                                                                    | Contratos únicos API ↔ web (rebuild com `pnpm --filter @movivo/shared run build`)                              |

Peças centrais (`apps/api/src`):

- **Estado do Aluno** (`modules/student-state/student-state.reader.ts`): fatias nomeadas (`identity`, `goals`, `availability`, `restrictions`, `preferences`, `training`, `nutrition`, `body`, `adherence`, `safety`, `recentDecisions`, `followUp`, `cycle`), lidas sob RLS do aluno, sem PII direta; saúde só com consentimento ativo.
- **Tarefas de agente** (`core/agents`): `defineAgentTask` = papel + instruções + tier + metodologia + fatias + schemas Zod + validadores determinísticos + rodadas de correção. `AgentRunner` monta o prompt (constituição → **ficha do agente** → papel → tarefa → metodologia → dados) e nunca dá ferramentas ao modelo.
- **Gateway de modelos** (`core/ai`): tiers FAST / STANDARD / REASONING / VISION configuráveis em `model_tiers`, failover entre DeepSeek / OpenAI / Anthropic, pseudonimização, custo e auditoria em `model_runs`. Aceita imagem e **PDF** (rota precisa ter visão).
- **Rotas atualmente gravadas no banco local** (31/10/2026; também auditadas em `audit_logs`): FAST = DeepSeek `deepseek-flash` → OpenAI `gpt-4.1-mini`; STANDARD = Anthropic `claude-sonnet-5-5` → OpenAI `gpt-6.1-sol` → DeepSeek `deepseek-v4-pro`; REASONING = OpenAI `gpt-6.1-sol` → Anthropic `claude-sonnet-5-5`; VISION = OpenAI `gpt-6.1-sol` → Anthropic `claude-sonnet-5-5`. Fallback ocorre quando o provedor/modelo falha; não é troca automática após uma resposta válida de baixa qualidade. Essa configuração está no Postgres local, não no Git; outros ambientes precisam receber as rotas separadamente.
- **Motor de políticas** (`modules/coaching/decision`): proposta → veredito (EXECUTE / ASK / ESCALATE / BLOCK) por emergência, sinal ativo, pausa, autonomia, limites e incerteza.
- **Eventos de domínio** (`modules/domain-events`): outbox transacional + relé + consumidores idempotentes com recibo.
- **Fila de exceções** (`modules/exceptions`): casos por domínio/conselho.
- **Conselho de agentes**: estratégia, força, corrida, HYROX, híbrido, nutrição, comunicação, **coordenador**, **recuperação**, **hábitos**, **medicina**. Hierarquia do coordenador: segurança > medicina > recuperação > nutrição > modalidades > preferências.

Regras de código: texto PT-BR; sem `any`; sem `console.log`; `knip` limpo; comentários curtos só quando o código não explica; módulo de domínio não importa outro módulo de domínio (importar função pura é aceito; integrações entre módulos por evento `DomainEventBus.request/register` ou outbox).

---

## 4. O que já foi desenvolvido

### 4.1 Base da v2 (marcos M0–M11, `movivo-docs/v2/PROGRESSO.md`)

Concluídos no código: fundação e CI (M0); contratos, tabelas v2, RLS e outbox (M1); gateway de modelos, framework de agentes e avaliação (M2); estúdio de metodologia, políticas e sentinela (M3); catálogos de exercícios e HYROX (M4, TACO oficial pendente); onboarding de 8 blocos e anamnese complementar (M5); motor de objetivos e plano integrado (M6); execução diária, registro alimentar e check-in adaptativo (M7); orquestrador conversacional (M8); revisão semanal e preferências (M9); painel por exceção e RBAC por conselho (M10); corte e arquivamento do legado em `legacy_*_archive` (M11).

### 4.2 Fase 1 — fluxo pós-anamnese de ponta a ponta

| Entrega                               | Como                                                                                                                                                                                                                                | Por quê                                                                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Caso resolvido regera o plano         | `exceptions.service` grava `ExceptionResolved`; `planning/plan-generation.worker.ts` gera o plano quando um caso SAFETY/DECISION_FAILURE é resolvido                                                                                | PAR-Q aprovado nunca gerava plano (o único gatilho era o onboarding)                                |
| Aprovar plano na fila publica e envia | `planning/plan-approval.handler.ts` (DecisionMade por STAFF → ativa rascunho, agenda, envia); `plan-delivery.service.ts`                                                                                                            | Com autonomia "encaminhar à equipe", o plano ficava em rascunho para sempre                         |
| Revisão completa do protocolo         | `planning/protocol-review.service.ts`; rotas `GET/PUT exceptions/:id/protocol`, `POST exceptions/:id/request-adjustment`; ajuste refeito por `PlanGenerationService.adjustFromCase`; web `components/dashboard/protocol-review.tsx` | O profissional precisa ver, editar à mão e pedir ajuste antes de aprovar                            |
| PDFs de treino e alimentação          | `planning/plan-pdf.ts` (pdfkit, cores da marca), rota `GET plans/by-token/:token/pdf/(treino\|alimentacao)`; enviados como documento pelo WhatsApp                                                                                  | O aluno recebe o plano em PDF além do link; URL em vez de base64 mantém dado de saúde fora do Redis |
| Tela de sucesso                       | "Treinador MOVIVO", menção à revisão pelos profissionais, convite CLUB                                                                                                                                                              | Pedido de produto                                                                                   |

### 4.3 Fase 2 — conselho de agentes

| Entrega                            | Como                                                                                                                                                                                                                      | Por quê                                                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fichas dos agentes                 | Tabela `agent_profiles` (versionada), `core/agents/agent-profile.reader.ts`, painel `/dashboard/ia/fichas`, capability `AGENT_PROFILES_WRITE` (só ADMIN); publicação exige passar nos casos de avaliação                  | Identidade e forma de trabalhar de cada agente editáveis sem deploy, com controle de qualidade                                                                               |
| Coordenador                        | `planning/tasks/coordinator.ts` (`coordination.review_protocol`), roda na geração e pede até 1 ajuste por parte                                                                                                           | Treino e alimentação precisam formar um protocolo coerente                                                                                                                   |
| Analistas de Recuperação e Hábitos | `progress/analyst-tasks.ts` (`recovery.analyze_week`, `habits.analyze_week`), sinais `RECOVERY_LOW` e `BARRIER_REPORTED`, check-in na revisão semanal, fatia `followUp` para a conversa, seção "Acompanhamento" no painel | Entender necessidades e dificuldades do aluno no acompanhamento; hipóteses, nunca diagnóstico; sofrimento emocional vai para o profissional (CVV 188 / SAMU 192 já existiam) |

### 4.4 Fase 3 — novas frentes

| Entrega                                  | Como                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Por quê                                                                                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Relatório mensal + previsão de prova** | `progress/monthly-report.ts` (resumo, Riegel 1,06 até 4× a distância base) e `monthly-report.service.ts`; disparo na 1ª segunda do mês pelo `WeeklyReviewScheduler`; PDF em `GET reports/by-token/:token/:month`                                                                                                                                                                                                                                                                                                                         | Mostrar evolução e motivar; previsão só com corrida ≥ 3 km                                                                                               |
| **Convite MOVIVO CLUB**                  | `MOVIVO_CLUB_URL` em `@movivo/shared`; bolha extra só na 1ª entrega do plano                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Comunidade existe no WhatsApp; só o convite                                                                                                              |
| **Ciclo menstrual**                      | Consentimento próprio `MENSTRUAL_CYCLE` aceito pelo WhatsApp (`AUTORIZO CICLO`, função SQL `record_user_consent`), registro "menstruei hoje/ontem/dia N", datas cifradas (`student_health_records`, kind `MENSTRUAL_CYCLE`), fatia `cycle` com fase **estimada**, lida pela conversa e pelo analista de recuperação; `REVOGAR CICLO` apaga as datas (`student-state/menstrual-cycle*.ts`)                                                                                                                                                | Ajustar intensidade e recuperação ao que a aluna relata; nunca prescrever só pela fase                                                                   |
| **Medicina (exames)**                    | Aluno anexa PDF/foto no WhatsApp → `whatsapp-inbound` confere tipo/tamanho/bytes e entrega por evento → `modules/medical`: arquivo cifrado em `medical_exams`, fila `medical-exam`, tarefas `medical.read_exam` (VISION, PDF direto ao modelo) e `medical.comment_exam` (REASONING); comentário cauteloso ao aluno + aviso de que não substitui consulta; resumo vira registro de saúde `EXAM` (contexto do planejamento); ponto de atenção abre caso `MEDICAL_EXAM` para o CRM, que vê leitura, comentário e arquivo original no painel | Decisão de produto: explicar o exame (dentro/fora da referência do laudo, especialidade a procurar) sem diagnóstico, com o médico da equipe acompanhando |
| **Strava**                               | "conectar Strava" no WhatsApp → link → OAuth → tokens cifrados em `wearable_connections`; webhook `wearables/strava/webhook` → fila `wearable-sync` → busca a atividade com o token do atleta → `ExecutionService.importActivity` (treino concluído, cumpre a sessão do plano do dia) → confirmação no WhatsApp; "DESCONECTAR STRAVA" ou revogação no Strava apagam a conexão (`modules/training/strava/`)                                                                                                                               | Registro automático dos treinos sem esforço do aluno                                                                                                     |

Migrações desta etapa: `0093` a `0098` (`apps/api/drizzle/`), aplicadas no banco local. Em 31/10/2026, a API passou 1850 testes unitários, o web 1027, `knip` e `format:check`; o smoke de integração após as personas passou em 3 arquivos/12 testes. O commit `1e99b7f` foi enviado para `movivo-app-v2`. A configuração de `model_tiers` descrita acima foi gravada e auditada somente no Postgres local; não acompanha o commit nem foi aplicada à produção.

---

## 5. O que está pendente

### Antes de ir para produção

- **PR/deploy**: commits até `1e99b7f` estão na `movivo-app-v2`; falta integrar na `main`. Replicar as rotas `model_tiers` no ambiente de destino após aprovação dos evals.
- **Avaliar com o modelo real** (`pnpm --filter @movivo/api run eval --task <id>`): `coordination.review_protocol`, `recovery.analyze_week`, `habits.analyze_week`, `medical.comment_exam` (e testar `medical.read_exam` com exames reais; não tem casos). Contas OpenAI/Anthropic precisam de saldo; o tier **VISION** precisa de modelo que aceite PDF e com dado de saúde aprovado.
- **Estúdio → Autonomia**: "Publicar plano" = "Encaminhar à equipe" (o seed de dev deixa AUTO).
- **`API_PUBLIC_URL`** público e alcançável pela EvolutionAPI (PDFs) e pelo Strava (OAuth/webhook).
- **Strava**: criar o app, preencher `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET_FILE`, `STRAVA_WEBHOOK_VERIFY_TOKEN_FILE` (documentados nos `.env.example`; faltam os docker secrets) e registrar o webhook (`POST https://www.strava.com/api/v3/push_subscriptions` com `callback_url=<API_PUBLIC_URL>/api/v1/wearables/strava/webhook`).
- **Evals reais das rotas** (31/10/2026): FAST / `conversation.classify_inbound` com DeepSeek Flash passou 12/12 casos (R$ 0,1079). STANDARD / `conversation.answer_question` com Sonnet 5.5 passou 1/2; o caso de volume foi retestado após reforçar a faixa semanal e ainda reprovou (resposta com 5 frases e uma afirmação de foco não sustentada pelo estado do caso). O override com GPT-6.1 Sol também reprovou esse caso, por prescrever um número fixo em vez de uma faixa. REASONING / `coordination.review_protocol` com GPT-6.1 Sol passou 2/3; o caso `protocolo-coerente` gerou ADJUST. O override com Sonnet 5.5 também gerou ADJUST no mesmo caso. VISION / `vision.extract_workout_screenshot` com GPT-6.1 Sol passou 1/3; os casos de corrida/ciclismo omitiram o tempo. O override com Sonnet 5.5 passou 2/2 nesses mesmos casos. `medical.comment_exam` com GPT-6.1 Sol passou 2/3; a falha foi mencionar genericamente medicamentos/suplementos numa mensagem ao aluno. **Essas avaliações não passam o gate de publicação; não habilitar produção sem corrigir/reavaliar.** A ordem VISION no banco local permanece GPT-6.1 Sol → Sonnet 5.5, igual à tabela aprovada; os dados favorecem avaliar Sonnet como primário, mas é uma mudança da ordem aprovada e precisa de autorização.

### Jurídico

- Textos em rascunho: consentimento de saúde v4, IA v2, Termos, Política, fotos do corpo e **ciclo menstrual**.
- **Medicina**: risco regulatório (ANVISA RDC 657/2022, CFM) já apontado; o produto optou por comentário direto ao aluno.
- **Strava**: a especificação original (D7) excluía o Strava porque os termos da API restringem uso dos dados com IA; a decisão foi revista na Fase 3. Validar os termos antes de ativar.

### Personas da comunicação

Quem conversa com o aluno no WhatsApp é uma **persona** de IA, como na v1: **Mariana** para o público feminino e **Leonardo** para o masculino, escolhida pelo `users.biologicalSex` informado na anamnese (sem a informação, Mariana).

- **Como era na v1**: mesmas personas (decisão do fundador de 04/09/2026), nome e tom editáveis no painel (tabela `agent_config`, coluna `target_sex`); a persona se apresentava como **IA da MOVIVO** supervisionada pelo profissional real Leonardo Rodrigues Brito (CREF 206778-G/SP), sem fingir ser pessoa nem inventar biografia. Foram removidas no commit `021c819` (28/10/2026, remoção do `ai-coach` legado); a configuração antiga está em `legacy_agent_config_archive` e o código pode ser consultado com `git show 021c819^:apps/api/src/core/agent-config/agent-persona.service.ts`.
- **Como está implementado na v2** (31/10/2026):
  - Fichas `PERSONA_FEMALE` e `PERSONA_MALE` em `packages/shared/src/schemas/coaching/agent-profile.schema.ts` (`PERSONAS` com nome e artigo, `personaOf(sexo)`), editáveis em **Fichas dos agentes** no painel (só ADMIN; publicação passa pelos casos de `conversation.answer_question`). Migração `0098` libera as chaves no banco.
  - `PublishedAgentProfiles.persona()` (`core/agents/agent-profile.reader.ts`): usa a persona publicada do sexo do aluno; enquanto só uma estiver publicada, ela atende todos; sem nenhuma, vale o texto inicial do código (versão 0), que já traz nome e a regra de transparência.
  - `AgentRunner` (opção `persona`) acrescenta a seção `# Persona (quem fala com o aluno)` ao prompt, depois da ficha do agente de Comunicação; a versão do prompt registra a persona (ex.: `...COMMUNICATION.v3.PERSONA_MALE.v1`).
  - `conversation/orchestrator.service.ts` escolhe a persona pelo sexo do aluno e a passa para a resposta de dúvidas; a saudação (`greetingMessage`) se apresenta como "a Mariana / o Leonardo, assistente de IA da MOVIVO".
- **Pendente**: as demais mensagens fixas (entrega do plano, relatório mensal, ciclo, exames, Strava, emergência) ainda falam em nome da "equipe da MOVIVO", sem o nome da persona; o nome é fixo no código (`PERSONAS`), só o texto da ficha é editável; criar casos de avaliação próprios das personas (ex.: "você é humano?").

### Produto e código

- Exame em várias fotos é comentado foto por foto; a legenda do anexo não é usada (não identifica exame de terceiros).
- Fotos corporais (armazenamento privado e análise visual) — dependem de jurídico.
- TACO oficial não importada (precisa de download autorizado).
- Squash de migrações só depois do deploy completo.
- E2E com EvolutionAPI e Asaas reais não rodado.
- Landing ainda cita "MOVIVO CLUB" como item a validar; páginas dedicadas de nutrição/CRN não existem.
- `AGENTS.md` e `CLAUDE.md` foram esvaziados (estavam desatualizados); este arquivo os substitui.

---

## 6. Como trabalhar no repositório

```bash
pnpm install
pnpm run infra:up                                   # sobe a stack local (rebuild com código novo)
pnpm --filter @movivo/shared run build              # sempre depois de mexer em packages/shared

pnpm --filter @movivo/api exec tsc --noEmit -p .    # typecheck API
pnpm --filter @movivo/web exec tsc --noEmit -p .    # typecheck web
pnpm --filter @movivo/api exec vitest run           # unitários API
cd apps/web && npx vitest run                       # unitários web
pnpm run knip && pnpm run format:check              # código morto e formatação

# Integração (Postgres/Redis reais; pare o container da API antes)
docker stop movivo-api
HOST_POSTGRES_PORT=5432 DEV_PROFESSIONAL_PASSWORD_FILE= pnpm --filter @movivo/api exec vitest run --config vitest.integration.config.ts
docker start movivo-api

# Migrações
DEV_PROFESSIONAL_PASSWORD_FILE= pnpm --filter @movivo/api db:generate --name <nome>
HOST_POSTGRES_PORT=5432 DEV_PROFESSIONAL_PASSWORD_FILE= pnpm --filter @movivo/api db:migrate

# Avaliação de agentes com modelo real
pnpm --filter @movivo/api run eval --list
pnpm --filter @movivo/api run eval --task <id>
```

Cuidados:

- Funções SQL de segurança, RLS e grants vivem em `apps/api/src/core/database/security-policies.ts` e são reaplicadas pelo `db:migrate`; o app **não** tem INSERT direto em `consents`.
- Tabela nova de titular entra em `TENANT_TABLES` (e nas listas de `security-policies.spec.ts` e `test/migration.int-spec.ts`).
- Dado de saúde sempre por `HealthCipherService`; nunca em log, nunca em Redis.
- Texto para o aluno passa pelos guardrails de linguagem (`planning/tasks/common.ts`).

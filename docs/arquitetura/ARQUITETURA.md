# Arquitetura e Stack — MOVIVO

> Documento operacional derivado do relatório de arquitetura de Rafael Nakamura (`docs/fitness-ia-whatsapp/10-relatorio-rafael.md`), **corrigido e complementado** pelos relatórios de Alexandre (jurídico), Eduardo (financeiro), Sofia (UX/UI), Sato (segurança) e Victor (IA) — ver §3.1. Este arquivo é a referência rápida e **obrigatória** para qualquer código escrito neste repositório. Em caso de dúvida sobre justificativa/detalhe, os relatórios originais em `docs/fitness-ia-whatsapp/` são a fonte completa (diagramas de fluxo, DDL completo, benchmarks, threat model STRIDE).
>
> **⚠️ Correção crítica pós-Rafael:** o LLM principal definido originalmente (DeepSeek V3.2) foi **removido do projeto**. Ver §3.1 e §5.

**Princípio guia:** *"Simplicidade agora é velocidade no futuro. Cada abstração prematura é uma dívida técnica que pagamos com juros compostos."*

---

## 1. Decisão fundamental

**Monólito Modular com Bounded Contexts explícitos em NestJS — não microservices.**

Motivo: 3 co-fundadores engenheiros, early-stage, SLA de 99,9%, time-to-market agressivo. Microservices adicionariam ~40% de overhead de desenvolvimento e complexidade operacional sem ganho proporcional no volume esperado (< 5.000 usuários ativos no MVP). Módulos NestJS fortemente encapsulados permitem extração cirúrgica para microservices no futuro, um módulo por vez, quando necessário (ver §7).

Serverless (Vercel/Lambda) foi rejeitado: cold start de 500–2000ms é incompatível com o SLA de 30s do AI Coach, e BullMQ exige processo persistente.

---

## 2. Stack tecnológica — obrigatória, não é escolha aberta

| Camada | Tecnologia | Regra |
|---|---|---|
| Backend | **NestJS** | Monólito modular, módulos com contratos de interface explícitos, sem imports circulares |
| ORM | **Drizzle** | Nunca Prisma ou TypeORM (ver ADR-002) |
| Banco | **PostgreSQL + PGVector** | Extensões: `vector`, `uuid-ossp`, `pgcrypto` |
| Connection pooling | **PgBouncer** (transaction mode) | Desde o MVP, porta 5433. Proíbe prepared statements e `LISTEN/NOTIFY` — usar Redis Pub/Sub para comunicação assíncrona |
| Cache / filas | **Redis 7+** | AOF (`appendonly yes`, `appendfsync everysec`) + réplica + Sentinel (3 nós, quorum=2) em produção |
| Filas | **BullMQ** | 5 filas com parâmetros fixos — ver §6 |
| Frontend | **Next.js 15 (App Router)** | SSR/SSG/RSC |
| Auth dashboard | **Auth.js v5** | Integrado ao Next.js 15, só para o dashboard CREF |
| Auth backend | **JWT** (`@nestjs/passport` + `passport-jwt`) | Access token 15min + refresh token httpOnly cookie 30 dias, com rotation (ADR-006) |
| Real-time | **Socket.io** + adapter Redis | Uso seletivo: só notificações do dashboard CREF |
| LLM principal | **OpenAI GPT-4.1** | Endpoint com Zero Data Retention + DPA/SCC + no-training (obrigatório — dado de saúde) |
| LLM fallback | **Anthropic Claude Sonnet 4.5** | Também ZDR + DPA/SCC. Failover por circuit breaker <2s (first-token timeout/5xx/429) |
| ~~LLM~~ | ~~DeepSeek V3.2~~ | **Removido do projeto por completo** (não só do caminho de saúde) — ver ADR-005-R em §3.1 |
| Embeddings RAG | **text-embedding-3-small** (OpenAI) | 1536 dimensões |
| Vector search | **PGVector HNSW** | `m=16`, `ef_construction=64` |
| WhatsApp | **AraraHQ** (WhatsApp Business API) | Rate limit: 80 msg/s (Meta), 100K msg/dia (verificado) |
| Pagamentos | **Stripe** (internacional/cartão) + **Asaas** (PIX/boleto BR) | Webhooks idempotentes obrigatórios |
| Observabilidade | **OpenTelemetry + Prometheus + Grafana + Loki + Sentry** | Spans obrigatórios — ver §8 |
| Analytics de produto | **PostHog** | Eventos de funil obrigatórios (herdados de Lucas) |
| CDN / WAF | **Cloudflare** | DDoS, bot management, OWASP Top 10 |
| Proxy reverso | **Nginx** | Rate limit por IP, terminação SSL |
| Infra MVP | **VPS Hostinger KVM 2** | 2 vCPU AMD EPYC, 8GB RAM, 100GB NVMe, ~R$75/mês |
| Containers | **Docker / Docker Compose** (MVP) → Kubernetes (Fase B) | Stateless por desenho — sem exceções |
| CI/CD | **GitHub Actions** | lint → test → build → deploy, rolling update zero-downtime |
| Validação | **Zod** | Todos os DTOs de entrada |
| Monorepo | `apps/web`, `apps/api`, `packages/shared` | Estrutura fixa |

---

## 3. ADRs — decisões já tomadas (não reabrir sem novo ADR formal)

| ADR | Decisão | Alternativas rejeitadas |
|---|---|---|
| **001** | Monólito Modular (NestJS) | Microservices desde o início, Serverless, Monólito sem separação modular |
| **002** | ORM: **Drizzle** | Prisma (overhead de runtime, N+1 fácil), TypeORM (decorators frágeis), Kysely (verboso) |
| **003** | **PgBouncer** transaction pooling desde o MVP | Sem pooling (limite de ~100 conexões na VPS) |
| **004** | Redis standalone + AOF + réplica + **Sentinel** em produção | Redis Cluster (só necessário >10GB), Valkey (reservado Fase 2+) |
| **005** | LLM routing: **DeepSeek V3.2 → GPT-4.1 → Claude Sonnet 4.5**, cascata por disponibilidade, circuit breaker <2s | Um único provedor fixo |
| **006** | Auth: **JWT access (15min) + refresh httpOnly (30 dias) com rotation** | Sessão server-side pura, OAuth-only |
| **007** | Frontend↔Backend: **REST para CRUD + WebSocket seletivo** (só notificações real-time do dashboard CREF) | gRPC, GraphQL (complexidade desnecessária no estágio atual) |

### 3.1 ADR-005-R — Revisão obrigatória: LLM principal (SUPERSEDED)

**A ADR-005 original (DeepSeek V3.2 como principal) está formalmente superada.** Motivo — três achados independentes e convergentes na Fase 2/4 do pipeline:

- **Alexandre (jurídico):** DeepSeek opera com servidores na China, sem adequação/SCC vigente para o Brasil sob a Resolução ANPD 19/2024 — inadequado para dados de saúde (LGPD Art. 11) sem salvaguardas contratuais que não existem hoje.
- **Sato (segurança):** DeepSeek teve um vazamento de dados público e documentado em jan/2025 (pesquisa Wiz — base exposta com +1M linhas de chat, chaves e segredos). Não é um risco hipotético.
- **Eduardo (financeiro):** trocar o LLM principal custa ~R$0,95–0,97/usuário/mês a mais — irrelevante para o unit economics (~2,8% do ARPU).
- **Victor (IA):** formalizou a correção e decidiu remover o DeepSeek **por completo do MVP**, inclusive de fluxos não relacionados a saúde — manter dois "mundos" de provedor por classe de dado adiciona risco de vazamento por bug que supera a economia marginal.

**Nova decisão (ADR-005-R):** **GPT-4.1 (OpenAI) como LLM principal → Claude Sonnet 4.5 (Anthropic) como fallback**, ambos com Zero Data Retention + DPA com SCCs + no-training. Circuit breaker <2s. Custo revisado: **~R$1,08/usuário/mês** (vs. ~R$0,11 estimado originalmente com DeepSeek).

**Regra derivada, também inegociável:** `LLMRouter` é o **único ponto do sistema autorizado a chamar um LLM**. Todo prompt passa por um **PII Scrubber** (pseudonimização no boundary) antes de sair do backend — nenhum identificador direto de usuário (nome, telefone, e-mail) chega ao prompt.

Detalhamento completo: `docs/fitness-ia-whatsapp/06-relatorio-alexandre.md`, `11-relatorio-sato.md`, `07-relatorio-eduardo.md`, `12-relatorio-victor.md`.

---

## 4. Diagramas C4

### Nível 1 — Contexto do Sistema

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           MOVIVO — Sistema                              │
│                                                                         │
│   [Usuário Final]                                                       │
│   Browser ──────────► Landing Page + Formulário (Next.js 15)           │
│   WhatsApp ◄────────► AI Coach (via AraraHQ ← NestJS)                 │
│                                                                         │
│   [Profissional CREF]                                                   │
│   Browser ──────────► Dashboard de Operações (Next.js 15)              │
│                                                                         │
│   [Sistema MOVIVO] ◄──► AraraHQ (WhatsApp Business API)               │
│   [Sistema MOVIVO] ◄──► Stripe / Asaas (Pagamentos)                   │
│   [Sistema MOVIVO] ◄──► OpenAI / Anthropic (LLM APIs, ZDR+DPA/SCC)   │
│   [Sistema MOVIVO] ──── PostHog (Analytics)                            │
│   [Sistema MOVIVO] ──── Cloudflare (CDN / WAF / DDoS)                 │
└─────────────────────────────────────────────────────────────────────────┘
```

### Nível 2 — Containers

```
                        ┌─────────────────────────────┐
                        │      Cloudflare WAF/CDN      │
                        └──────────────┬──────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
              ▼                        ▼                        ▼
   ┌────────────────────┐  ┌────────────────────┐  ┌──────────────────────┐
   │  Next.js 15 App    │  │   NestJS Backend   │  │ AraraHQ Webhook      │
   │  (SSR/SSG)         │  │   (Modular Mono.)  │  │ (entrada WhatsApp)   │
   │  Port: 3000        │  │   Port: 3001       │  └────────┬─────────────┘
   │                    │  │                    │           │
   │  - Landing Page    │  │  - REST API        │           │ POST /webhook
   │  - Formulário      │  │  - Webhook Handler │◄──────────┘
   │  - Dashboard CREF  │  │  - BullMQ Workers  │
   │  - Auth (Auth.js)  │  │  - Schedulers      │
   └────────────────────┘  └──────────┬─────────┘
                                      │
              ┌───────────────┬───────┴────────────┬─────────────┐
              ▼               ▼                    ▼             ▼
   ┌──────────────┐  ┌───────────────┐  ┌──────────────┐  ┌──────────┐
   │  PostgreSQL  │  │    Redis 7+   │  │  PgBouncer   │  │  Loki    │
   │  (dados)     │  │  (cache/fila) │  │  (conn pool) │  │  (logs)  │
   │  + PGVector  │  │  + Sentinel   │  │              │  │          │
   │  Port: 5432  │  │  Port: 6379   │  │  Port: 5433  │  │ Port:3100│
   └──────────────┘  └───────────────┘  └──────────────┘  └──────────┘
              │                                              ┌──────────┐
              └──────────────────────────────────────────►  │Prometheus│
                                                            │+ Grafana │
                                                            └──────────┘
```

### Nível 3 — Módulos NestJS

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     NestJS Backend — Módulos                            │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  CORE (infraestrutura compartilhada)                            │   │
│  │  ConfigModule · DatabaseModule · RedisModule · LoggerModule     │   │
│  │  TelemetryModule · EventBusModule (CQRS)                        │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌────────────────┐  ┌──────────────────┐  ┌────────────────────────┐  │
│  │  AUTH MODULE   │  │  ANAMNESIS       │  │  PROTOCOL MODULE       │  │
│  │  - AuthGuard   │  │  MODULE          │  │  - MotorDeterministico │  │
│  │  - JwtService  │  │  - FormSession   │  │  - ProtocolGenerator   │  │
│  │  - UserService │  │  - ConsentService│  │  - VersioningService   │  │
│  │                │  │  - PAR-Q Gate    │  │  - SignatureService    │  │
│  └────────────────┘  └──────────────────┘  └────────────────────────┘  │
│  ┌────────────────┐  ┌──────────────────┐  ┌────────────────────────┐  │
│  │  WHATSAPP      │  │  AI COACH        │  │  SUBSCRIPTION MODULE   │  │
│  │  MODULE        │  │  MODULE          │  │  - TrialService        │  │
│  │  - WebhookCtrl │  │  - ContextSvc    │  │  - ConversionSeq       │  │
│  │  - MessageSvc  │  │  - LLMRouter     │  │  - StripeService       │  │
│  │  - TemplateSvc │  │  - RAGService    │  │  - AsaasService        │  │
│  │  - RateLimiter │  │  - ValidatorSvc  │  │  - WebhookHandlers     │  │
│  └────────────────┘  └──────────────────┘  └────────────────────────┘  │
│  ┌────────────────┐  ┌──────────────────┐  ┌────────────────────────┐  │
│  │  CHECKIN       │  │  JOBS MODULE     │  │  ADMIN/CREF MODULE     │  │
│  │  MODULE        │  │  (BullMQ)        │  │  - DashboardService    │  │
│  │  - CheckinSvc  │  │  - QueueManager  │  │  - AuditService        │  │
│  │  - AdjustSvc   │  │  - WorkerFactory │  │  - FlagService         │  │
│  │  - Scheduler   │  │  - DLQ Handler   │  │  - ReportService       │  │
│  └────────────────┘  └──────────────────┘  └────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Arquitetura de IA — regra inegociável

**A IA nunca decide o protocolo sozinha.** Arquitetura híbrida obrigatória:

- **Motor Determinístico** (TypeScript puro, sem dependências externas, versionado semver, **100% de cobertura de teste exigida**): calcula estado/regras CREF-safe — volume, periodização, fases (`ADAPTACAO`→`HIPERTROFIA`→`FORCA`→`DELOAD`), constraints (PAR-Q, lesões).
- **LLM (GPT-4.1 → Claude Sonnet 4.5, ver ADR-005-R)**: só gera linguagem natural a partir do estado calculado pelo motor, sempre através do `LLMRouter`. Nunca decide o protocolo.
- **PII Scrubber**: pseudonimização obrigatória no boundary de saída — nenhum identificador direto do usuário chega ao prompt do LLM (regra derivada da ADR-005-R).
- **Intent Classifier**: taxonomia `DUVIDA_TECNICA · SUBSTITUICAO_EXERCICIO · MOTIVACAO · CHECKIN_ANTECIPADO · FORA_DE_ESCOPO`, via embedding-kNN (OpenAI) com fallback em GPT-4.1-nano e guardrail regex clínico; prompt de sistema versionado por intenção.
- **Validação pós-geração (compliance CREF)**: checklist regex+regras bloqueia diagnóstico médico, prescrição medicamentosa, violação de constraints PAR-Q, extrapolação de escopo CREF. Falha → `human_review_required=true` + resposta-padrão pré-aprovada + notificação ao dashboard. Safety score é **gate bloqueante** no framework de avaliação de Victor, não apenas métrica de acompanhamento.
- **Guardrails anti-prompt-injection/jailbreak**: obrigatórios no prompt de sistema do AI Coach — usuários podem tentar manipular o Motor Determinístico via linguagem natural; o LLM nunca deve aceitar instruções do usuário que alterem constraints de PAR-Q ou volume de treino.

**Memória em 3 camadas** (arquitetura definida por Lucas, formalizada por Rafael):

1. **Working (Redis)** — `session:{user_id}:{date}`, TTL 24h, últimas 10–15 mensagens.
2. **Episodic (PostgreSQL)** — protocolo atual, semana, ajustes, check-ins.
3. **Semantic (PGVector + RAG)** — corpus ACSM/NSCA/PubMed, ativado só em dúvida técnica, top-3 chunks, threshold de similaridade > 0.75.

---

## 6. Filas BullMQ — parâmetros fixos

| Fila | Workers | Lock | Retries | Observação |
|---|---|---|---|---|
| `protocol-generation` | 5 | 120s | 3 (backoff 2s/8s/32s) | DLQ |
| `ai-response` | 20 | 45s | 2 (3s/9s) | Priority por tier (pago > trial), rate limit 80 jobs/s |
| `whatsapp-outbound` | 10 | 30s | 5 | Rate limit 80 jobs/s global (limite Meta) |
| `checkin-weekly` | 10 | — | 3 | Cron `0 8 * * MON` América/São_Paulo, spread aleatório 0–7200s |
| `conversion-sequence` | 5 | — | — | Delayed jobs para dias 7/10/13/14 do trial |

DLQ handler obrigatório em todas: alerta Sentry + mensagem de fallback ao usuário via WhatsApp + task manual no dashboard.

---

## 7. Bounded Contexts (DDD)

```
IDENTITY & ACCESS       — User, AuthSession, Permission
ONBOARDING & ANAMNESIS  — AnamnesisSession, ConsentRecord, PARQAssessment
TRAINING & PROTOCOL     — Protocol, ProtocolVersion, TrainingPhase, Exercise, CheckIn
COACHING & CONVERSATION — Conversation, Message, CoachingSession, AIJobRecord
SUBSCRIPTION & BILLING  — Subscription, PaymentEvent, TrialPeriod, ConversionSeq
COMPLIANCE & AUDIT      — AuditLog, ProtocolSignature, ComplianceFlag, DataSubjectRequest
```

`Protocol` é o agregado raiz crítico: `id, userId, version, status (DRAFT|PENDING_SIGNATURE|ACTIVE|SUPERSEDED), professionalId, signedAt, phases[]→sessions[]→exercises[]`. Constraints são **imutáveis pós-criação**.

Extração futura para microservices, quando necessária (Fase C, 15.000+ usuários), segue esta ordem: `whatsapp-gateway` → `ai-engine` → `protocol-service`.

---

## 8. Segurança, LGPD e observabilidade — não-negociáveis

- **Tenant isolation (corrigido por Sato)**: toda chave Redis prefixada por `user_id`; repositórios Drizzle com `UserScopedQuery<T>` forçando `userId` em compile-time. Row-Level Security no Postgres é **obrigatória, não opcional** — e como o PgBouncer roda em *transaction pooling mode* (ADR-003), RLS sozinha vazaria entre tenants: é obrigatório usar `SET LOCAL app.current_user_id` no início de cada transação, políticas com `FORCE ROW LEVEL SECURITY`, e a role da aplicação (`movivo_app`) **nunca** pode ter `BYPASSRLS` nem ser dona das tabelas. Jobs BullMQ nunca compartilham estado entre usuários.
- **LGPD Art. 11 (dados de saúde)**: bloco de saúde da anamnese criptografado em repouso (`pgcrypto`); telefone nunca logado em texto claro; PAR-Q flags em JSONB criptografado; `audit_logs` **append-only garantido a nível de banco** (GRANT restritivo + RULE/trigger que bloqueia UPDATE/DELETE + hash chain entre registros — não confiar apenas em política de aplicação), retido 5 anos (base legal: CDC art. 27, não apenas LGPD); direito ao esquecimento via anonimização + retenção defensiva mínima, com DROP de partição mensal quando aplicável.
- **Redis — patch obrigatório**: subir sempre com a versão corrigida contra **CVE-2025-49844 "RediShell" (CVSS 10)** antes de qualquer deploy, bind apenas em rede interna, TLS/mTLS entre app e Redis (defense in depth, não só AOF+Sentinel).
- **Webhook AraraHQ — replay protection**: validação HMAC (`crypto.timingSafeEqual`) **não é suficiente sozinha** — adicionar timestamp assinado com janela de tolerância ±5min, nonce armazenado no Redis para detectar replay, e idempotência no processamento do evento.
- **LLM boundary**: nenhum identificador direto de usuário chega ao prompt (PII Scrubber, ver §3.1/§5); `LLMRouter` é o único ponto autorizado a chamar um provedor de LLM.
- **Camadas de API security**: Cloudflare WAF → Nginx (rate limit) → NestJS Guards (JWT/RBAC/HMAC) → Drizzle (queries parametrizadas, sempre com `SET LOCAL` de tenant) → Zod (validação de DTOs).
- **Secrets**: MVP = Docker Secrets + `.env` (nunca commitado); Fase B = Vault/AWS Secrets Manager. Rotação obrigatória de JWT signing key, webhook secrets e chaves de API de LLM/pagamento.
- **DevSecOps no CI/CD**: SAST + SCA + secret scanning + dependency scanning no GitHub Actions antes de qualquer merge para `main`.
- **SLOs críticos**: disponibilidade API ≥99,9%/mês · latência AI Coach p95 ≤30s (alerta em 25s) · protocolo inicial ≤2h p95 · check-in disparado na janela seg 08–10h BRT · jobs em DLQ <0,5% · respostas bloqueadas por compliance <5%.
- **Spans OpenTelemetry obrigatórios** em: pipeline de webhook→fila→job, pipeline de AI Coach (context→intent→RAG→LLM→validação→envio), pipeline de protocolo, pipeline de check-in.

Detalhamento completo (threat model STRIDE, pentest da anamnese, política de rotação de secrets fase a fase): `docs/fitness-ia-whatsapp/11-relatorio-sato.md`. Este documento define os controles arquiteturais mínimos, não substitui a revisão de segurança dedicada.

---

## 9. Escalabilidade — 3 fases

1. **Fase A (MVP → 2.000 usuários)**: VPS Hostinger; upgrade se CPU>70%/15min ou p95>25s; Redis réplica em 2º VPS; read replica Postgres.
2. **Fase B (2.000 → 15.000 usuários)**: Kubernetes gerenciado (EKS/GKE); Postgres→RDS Multi-AZ; Redis→ElastiCache Multi-AZ; BullMQ workers em pods com HPA.
3. **Fase C (15.000+ usuários)**: extração cirúrgica de microservices (ver §7); CQRS completo com event sourcing.

Todos os containers são **stateless por design** — estado sempre em Redis/Postgres externos, configuração via env vars, segredos via Docker Secrets/Vault. Sem exceções.

---

## 10. Roadmap de implementação — ordem obrigatória (Sprint 0 a 6, ~11 semanas com 3 devs)

```
SPRINT 0 (1 sem) — Fundação
  Monorepo · Docker Compose (PG+PgBouncer+Redis+Sentinel) · NestJS boilerplate
  Drizzle schema inicial · CI/CD básico · gestão de secrets

SPRINT 1 (2 sem) — Core Usuário / Anamnese
  AUTH (JWT+refresh) · ANAMNESIS (3 blocos) · CONSENT (LGPD)
  Next.js landing + formulário · BullMQ setup

SPRINT 2 (2 sem) — Pipeline de Protocolo
  Motor Determinístico (100% coverage) · LLMRouter + fallbacks + circuit breaker
  ProtocolGenerationWorker · integração AraraHQ · eventos PostHog de onboarding

SPRINT 3 (2 sem) — AI Coach
  WebhookController (HMAC+debounce+lock) · AIResponseWorker
  ContextService 3 camadas · ValidationService de compliance
  Indexação PGVector · RAGService

SPRINT 4 (1 sem) — Conversão / Billing
  SUBSCRIPTION (Stripe+Asaas) · ConversionSequenceWorker (d7/10/13/14)
  Webhooks de pagamento (idempotentes) · eventos PostHog de conversão

SPRINT 5 (2 sem) — Check-in / Dashboard CREF
  CheckinWeeklyWorker + cron · ajuste pós-check-in
  Dashboard Next.js · WebSocket · AUDIT (log imutável + assinatura)

SPRINT 6 (1 sem) — Observabilidade / Hardening
  OpenTelemetry · Prometheus+Grafana+Loki · Sentry
  Testes de carga (Mariana) · revisão de segurança (Sato)
```

Todos os relatórios de Fase 2–4 (Alexandre, Eduardo, Sofia, Sato, Victor) já foram concluídos — não há mais bloqueador de pipeline para iniciar o Sprint 0. O consentimento LGPD (Alexandre), os wireframes (Sofia) e o threat model (Sato) devem ser lidos por Leonardo/Felipe antes de implementar ANAMNESIS e AUTH no Sprint 1.

---

## 11. Riscos técnicos conhecidos e mitigação

| Risco | Mitigação |
|---|---|
| Instabilidade do GPT-4.1 | Cascata de fallback para Claude Sonnet 4.5, circuit breaker <2s (ADR-005-R) |
| Vazamento de dados de saúde via provedor de LLM inadequado | DeepSeek removido do projeto; só provedores com ZDR+DPA/SCC (ADR-005-R) |
| Redis como ponto único de falha | AOF + réplica + Sentinel |
| Exploração de vulnerabilidade crítica do Redis (CVE-2025-49844) | Patch obrigatório antes de deploy + bind interno + TLS/mTLS |
| Vazamento entre tenants via PgBouncer transaction mode + RLS mal configurada | `SET LOCAL` de tenant por transação + `FORCE ROW LEVEL SECURITY` + role sem `BYPASSRLS` |
| Replay attack no webhook AraraHQ | HMAC + timestamp assinado (±5min) + nonce Redis + idempotência |
| Rate limit da AraraHQ | Fila `whatsapp-outbound` com rate limit 80 jobs/s |
| Explosão de custo de LLM por abuso | Rate limit de 50 mensagens/dia por usuário |
| Violação de LGPD | RLS forçada + isolamento por namespace + audit log append-only garantido por permissão de banco |
| Alucinação em prescrição | Validação pós-geração + fallback seguro + safety score como gate bloqueante |
| Prompt injection / jailbreak no AI Coach | Guardrails no prompt de sistema + PII Scrubber no boundary |
| Abandono de formulário (>50%) | Salvamento de progresso + token de retorno + fluxo conversacional desenhado por Sofia |
| PgBouncer transaction mode incompatível com features do Postgres | Eliminar `LISTEN/NOTIFY`; usar Redis Pub/Sub |
| Colisão de marca MOVIVO com marca de alto renome VIVO | Busca de anterioridade + parecer de PI no INPI antes de investir; TRENOVA como plano B (Alexandre) |

---

## 12. Regras inegociáveis — resumo executável

1. Nunca introduzir microservices antes da Fase C (15.000+ usuários) sem novo ADR formal.
2. Nunca trocar Drizzle por Prisma/TypeORM.
3. Nunca remover o PgBouncer do caminho de conexão ao Postgres.
4. Nunca deixar o LLM decidir o protocolo — decisão sempre passa pelo Motor Determinístico.
5. Nunca pular a validação pós-geração (compliance CREF) antes de enviar uma resposta da IA ao usuário.
6. Nunca introduzir estado em memória local do container — tudo stateless, estado em Redis/Postgres.
7. Nunca versionar segredos (`.env`, chaves de API, credenciais) no Git.
8. Motor Determinístico exige 100% de cobertura de teste antes de merge.
9. Toda tabela com dado de saúde/pessoal segue LGPD Art. 11: criptografia em repouso, RLS forçada, audit log append-only garantido por permissão de banco.
10. Toda mudança de API segue o esquema de versionamento (`v1`, dual-support 90 dias em breaking changes).
11. **Nunca usar DeepSeek em nenhum fluxo do projeto** — removido por decisão jurídica e de segurança (ADR-005-R). LLM principal é GPT-4.1, fallback é Claude Sonnet 4.5, ambos com ZDR+DPA/SCC.
12. `LLMRouter` é o único ponto do sistema autorizado a chamar um provedor de LLM; todo prompt passa pelo PII Scrubber antes de sair do backend.
13. RLS no Postgres exige `SET LOCAL app.current_user_id` por transação e `FORCE ROW LEVEL SECURITY` — nunca confiar em RLS "por padrão" sob PgBouncer transaction mode.
14. Redis nunca sobe em produção sem o patch para CVE-2025-49844 (RediShell) aplicado.
15. Webhooks (AraraHQ, Stripe, Asaas) exigem validação de assinatura + proteção contra replay (timestamp + nonce) + idempotência — nunca apenas checagem de secret estático.

---

## Fonte completa

Todos os relatórios abaixo estão em `docs/fitness-ia-whatsapp/` e são a fonte completa por trás deste documento:

- `10-relatorio-rafael.md` — arquitetura original: diagramas de fluxo detalhados, DDL completo das tabelas, contratos REST completos, benchmarks.
- `06-relatorio-alexandre.md` — societário, LGPD/RIPD, ToS/Política de Privacidade, registro CREF/INPI, o achado que invalidou o DeepSeek.
- `07-relatorio-eduardo.md` — pricing final, unit economics, regime tributário, necessidade de capital.
- `09-relatorio-sofia.md` — wireframes, fluxo de UX do formulário e do dashboard CREF, persona "MOVI".
- `11-relatorio-sato.md` — threat model STRIDE completo, RLS/PgBouncer, CVE do Redis, pentest da anamnese, DevSecOps.
- `12-relatorio-victor.md` — ADR-005-R formal, LLMRouter, ContextService, Intent Classifier, RAG, ValidationService, LLMOps.

"Próximos Passos por Agente" de Rafael (recomendações específicas para Leonardo, Felipe, Mariana e Henrique) seguem válidas em `10-relatorio-rafael.md` §17.

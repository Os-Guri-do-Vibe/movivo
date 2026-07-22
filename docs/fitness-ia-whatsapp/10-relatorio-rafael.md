# Relatório — Rafael Nakamura (Distinguished Software Architect / Principal Engineer)

**Data:** 2026-07-22
**Ideia analisada:** MOVIVO — AI Coach de treino no WhatsApp
**Pasta do projeto:** docs/fitness-ia-whatsapp/
**Status do pipeline:** Fase 1 concluída (Clóvis/Gabriel/Caio/Kimura/Helena) → Fase 2 concluída (Alexandre/Eduardo) → Fase 3 concluída (Lucas/Sofia) → **Fase 4: Arquitetura — Rafael em andamento**

---

## Resumo Executivo

Este relatório entrega a **arquitetura de referência completa** da MOVIVO para todos os agentes de engenharia subsequentes (Sato, Victor, Leonardo, Felipe, Mariana, Henrique).

A decisão arquitetural fundamental é um **Monólito Modular com Bounded Contexts explícitos**, não microservices. Para 3 co-fundadores engenheiros em early-stage com SLA de 99,9% e time-to-market agressivo, microservices adicionariam latência operacional sem benefício proporcional. O monólito modular permite extrair módulos como microservices no futuro sem reescrita completa.

A stack escolhida — NestJS + PostgreSQL + Drizzle ORM + Redis + BullMQ + PGVector + Next.js 15 — é **validada em produção** e alinhada aos benchmarks mais recentes (Drizzle a 4.600 req/s com p95 ≤ 100ms; BullMQ a 27.200 jobs/s de pico; NestJS a 12.000 QPS). O caminho VPS Hostinger → cloud é explicitamente preparado com stateless containers, PgBouncer e Redis Sentinel desde o dia 1.

A arquitetura de IA híbrida (Motor Determinístico + LLM + RAG) é a escolha correta para o contexto regulatório CREF/LGPD: garante auditabilidade, reduz custo de tokens em ~60% e elimina o risco de alucinação em prescrição de exercícios.

**Princípio guia:** Simplicidade agora é velocidade no futuro. Cada abstração prematura é uma dívida técnica que pagamos com juros compostos.

---

## 1. Contexto e Requisitos

### 1.1 Requisitos Funcionais Críticos (RF)

| ID | Requisito | Origem |
|----|-----------|--------|
| RF-01 | Pipeline de geração de protocolo: formulário → protocolo WhatsApp em ≤ 2h | Lucas |
| RF-02 | AI Coach conversacional por WhatsApp com memória de sessão | Lucas |
| RF-03 | Check-in semanal automático com ajuste de protocolo | Lucas |
| RF-04 | Sequência de conversão pós-trial (dias 7, 10, 13, 14) | Lucas |
| RF-05 | Formulário de anamnese em 3 blocos com salvamento de progresso | Lucas |
| RF-06 | Dashboard de operações para profissional de Ed. Física (CREF) | Lucas |
| RF-07 | Versionamento de protocolos com assinatura eletrônica do profissional | Lucas/Alexandre |
| RF-08 | Isolamento de contexto por usuário — sem vazamento entre usuários | Lucas |
| RF-09 | Gate PAR-Q para contraindicações — flag + revisão humana | Clóvis/Alexandre |
| RF-10 | Consentimento LGPD granular registrado antes de dados de saúde | Alexandre |
| RF-11 | Gestão de assinaturas (trial 14 dias → pago R$29-59/mês) | Lucas/Eduardo |
| RF-12 | Integração Stripe (internacional) + Asaas (PIX/boleto BR) | Lucas/Eduardo |

### 1.2 Requisitos Não-Funcionais (RNF) — SLAs inegociáveis

| ID | Requisito | Target | Criticidade |
|----|-----------|--------|-------------|
| RNF-01 | Latência de resposta do AI Coach | ≤ 30s p95 | Crítico |
| RNF-02 | Confirmação de recebimento do formulário | ≤ 5s síncrona | Crítico |
| RNF-03 | Protocolo inicial entregue no WhatsApp | ≤ 2h p95 | Alto |
| RNF-04 | Check-in disparado toda segunda-feira | 08:00-10:00 BRT | Alto |
| RNF-05 | Uptime em produção | ≥ 99,9% | Crítico |
| RNF-06 | Isolamento de dados por usuário | Zero vazamento | Crítico (LGPD) |
| RNF-07 | Auditabilidade de todas as decisões de IA | Log imutável | Crítico (CREF) |
| RNF-08 | Throughput de mensagens WhatsApp saída | ≤ 80 msg/s (Meta limit) | Alto |
| RNF-09 | Cold start de containers | ≤ 5s | Médio |
| RNF-10 | Recuperação de falha Redis | ≤ 30s (Sentinel failover) | Alto |

### 1.3 Constraints Técnicos e de Negócio

- **Time:** 3 co-fundadores engenheiros (stack TypeScript — sem Ops dedicado no MVP)
- **Infra inicial:** VPS Hostinger KVM 2 (2 vCPU, 8 GB RAM, 100 GB NVMe) ~ R$75/mês
- **Regulatório:** Dados de saúde = dados sensíveis LGPD Art. 11 — tratamento reforçado obrigatório
- **CREF/CONFEF:** IA não prescreve — personaliza dentro de protocolos assinados por profissional
- **Custo LLM:** DeepSeek V3.2 como modelo principal ($0,14/$0,28 por 1M tokens)
- **WhatsApp rate limit:** 80 msg/s na API Meta/AraraHQ; 100K msg/dia para business verificado

---

## 2. Decisão Arquitetural Fundamental

### ADR-001 — Monólito Modular vs. Microservices

**Contexto:**
MOVIVO tem 3 co-fundadores engenheiros em early-stage. O produto precisa ser lançado e validado antes de escalar. Existe pressão para manter simplicidade operacional sem abrir mão da capacidade de escalar quando necessário.

**Decisão:**
**Monólito Modular com Bounded Contexts explícitos no NestJS.**

**Justificativa:**
Microservices resolvem problemas de escala de times (10+ engenheiros) e escala de produto (milhões de usuários). Para o estágio atual da MOVIVO, eles introduziriam:
- Latência de rede entre serviços (~5-15ms por hop) sem ganho proporcional
- Complexidade operacional exponencial (service discovery, distributed tracing obrigatório, gestão de múltiplos deployments)
- Overhead de desenvolvimento de ~40% em tempo para implementar contratos inter-serviço

O Monólito Modular oferece:
- **Módulos NestJS fortemente encapsulados** com contratos de interface bem definidos
- **Migração gradual e cirúrgica** para microservices quando necessário — extraindo um módulo por vez
- **Deploy único** com Docker Compose no MVP → Kubernetes quando necessário
- **Debugging simplificado** — stack traces completos, sem rastreamento distribuído obrigatório desde o início

**Benchmarks que suportam a decisão:**
- NestJS monólito: 8.500-12.000 QPS para o volume esperado do MVP (< 5.000 usuários ativos)
- Drizzle ORM: 4.600 req/s com p95 ≤ 100ms em PostgreSQL em produção (ECOSIRE, 66 schemas, ~100 tables)

**Alternativas Consideradas:**
1. **Microservices desde o início** — Rejeitado. Prematuridade fatal para early-stage com time pequeno.
2. **Serverless (Vercel/AWS Lambda)** — Rejeitado. Cold start de 500-2000ms é incompatível com SLA de 30s para AI Coach (cold start consumiria orçamento de latência). BullMQ requer processo persistente.
3. **Monólito único sem separação modular** — Rejeitado. Impossibilita extração futura e cria acoplamento que escala mal com o time.

**Consequências:**
- Positivas: velocidade de desenvolvimento, operação simples, debugging fácil
- Negativas: escalar individualmente cada componente requer extração de módulo (trabalho planejado, não urgente)
- Mitigação: boundaries de módulo definidos com contratos explícitos desde o início

---

## 3. Arquitetura Recomendada

### 3.1 Diagrama C4 — Nível 1: Contexto do Sistema

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
│   [Sistema MOVIVO] ◄──► DeepSeek / OpenAI / Anthropic (LLM APIs)     │
│   [Sistema MOVIVO] ──── PostHog (Analytics)                            │
│   [Sistema MOVIVO] ──── Cloudflare (CDN / WAF / DDoS)                 │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Diagrama C4 — Nível 2: Containers

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

### 3.3 Diagrama C4 — Nível 3: Componentes do NestJS Backend

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
│  │                │  │  MODULE          │  │                        │  │
│  │  - AuthGuard   │  │  - FormSession   │  │  - MotorDeterministico │  │
│  │  - JwtService  │  │  - ConsentService│  │  - ProtocolGenerator   │  │
│  │  - UserService │  │  - PAR-Q Gate    │  │  - VersioningService   │  │
│  └────────────────┘  └──────────────────┘  │  - SignatureService    │  │
│                                             └────────────────────────┘  │
│  ┌────────────────┐  ┌──────────────────┐  ┌────────────────────────┐  │
│  │  WHATSAPP      │  │  AI COACH        │  │  SUBSCRIPTION MODULE   │  │
│  │  MODULE        │  │  MODULE          │  │                        │  │
│  │                │  │                  │  │  - TrialService        │  │
│  │  - WebhookCtrl │  │  - ContextSvc    │  │  - ConversionSeq       │  │
│  │  - MessageSvc  │  │  - LLMRouter     │  │  - StripeService       │  │
│  │  - TemplateSvc │  │  - RAGService    │  │  - AsaasService        │  │
│  │  - RateLimiter │  │  - ValidatorSvc  │  │  - WebhookHandlers     │  │
│  └────────────────┘  └──────────────────┘  └────────────────────────┘  │
│                                                                         │
│  ┌────────────────┐  ┌──────────────────┐  ┌────────────────────────┐  │
│  │  CHECKIN       │  │  JOBS MODULE     │  │  ADMIN/CREF MODULE     │  │
│  │  MODULE        │  │  (BullMQ)        │  │                        │  │
│  │                │  │                  │  │  - DashboardService    │  │
│  │  - CheckinSvc  │  │  - QueueManager  │  │  - AuditService        │  │
│  │  - AdjustSvc   │  │  - WorkerFactory │  │  - FlagService         │  │
│  │  - Scheduler   │  │  - DLQ Handler   │  │  - ReportService       │  │
│  └────────────────┘  └──────────────────┘  └────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### 3.4 Fluxo de Processamento Completo — Protocolo Inicial

```
Usuário submete formulário (Next.js)
    │
    ▼ POST /api/anamnesis/submit
NestJS Controller (AnamnesisMódule)
    │ responde 202 Accepted em < 1s
    │ salva anamnesis_session com status=SUBMITTED
    ▼
BullMQ: enqueue job para fila "protocol-generation"
    │ job_id gerado, expira em 24h se não processado
    ▼
Worker: ProtocolGenerationWorker (concorrência = 5)
    ├── Busca usuário + anamnese completa (PostgreSQL via PgBouncer)
    ├── Motor Determinístico:
    │     ├── Calcula volume semanal (frequência × disponibilidade)
    │     ├── Seleciona exercícios dentro de constraints (equipamentos, lesões, PAR-Q)
    │     ├── Aplica periodização linear para iniciantes ou ondulada para intermediários
    │     └── Gera estrutura JSON do protocolo (sem texto ainda)
    ├── LLM Call (DeepSeek V3.2):
    │     ├── Prompt: estrutura JSON + instruções de formatação + persona MOVIVO
    │     └── Geração de texto humanizado do protocolo
    ├── Validação pós-geração:
    │     ├── Checklist: sem termos de diagnóstico médico, dentro de escopo CREF
    │     ├── Consistência com restrições PAR-Q do usuário
    │     └── Se falhar: fallback para template pré-aprovado + flag para revisão CREF
    ├── Salva protocolo no PostgreSQL (tabela protocols, version=1)
    ├── Envia protocolo formatado via AraraHQ (fila "whatsapp-outbound")
    └── Atualiza status na anamnesis_session + dispara evento PostHog "protocol_sent"

Total esperado: 2-8 minutos (bem dentro do SLA de 2h)
```

### 3.5 Fluxo de Processamento — AI Coach (mensagem de usuário)

```
Usuário envia mensagem WhatsApp
    │
    ▼ POST /webhook (AraraHQ → NestJS)
WebhookController
    │ responde 200 OK em < 200ms (obrigatório pela Meta)
    │
    ▼ Verifica assinatura HMAC do payload
    │ Se inválido: 401, log de segurança, encerra
    │
    ▼ Debounce: Redis SET NX com TTL 3s por user_id
    │ Se dentro de janela de debounce: acumula mensagem, agenda job único
    │
    ▼ Redis: acquireLock("session:lock:{user_id}", TTL=60s)
    │ Se lock não obtido: enqueue em fila pessoal do usuário, aguarda
    │
    ▼ BullMQ: enqueue job "ai-response" com prioridade por user_id
    │
    ▼ AIResponseWorker
    ├── Carrega contexto (3 camadas de memória):
    │     ├── Camada 1 — Redis: últimas 10-15 mensagens da sessão atual (TTL 24h)
    │     ├── Camada 2 — PostgreSQL: protocolo atual + semana + histórico de ajustes
    │     └── Camada 3 — PGVector: RAG busca top-3 documentos relevantes se dúvida técnica
    ├── Classifica intenção da mensagem:
    │     ├── DUVIDA_TECNICA → RAG ativado
    │     ├── SUBSTITUICAO_EXERCICIO → Motor Determinístico processa
    │     ├── MOTIVACAO → LLM direto (contexto leve)
    │     ├── CHECKIN_ANTECIPADO → Fluxo de check-in
    │     └── FORA_DE_ESCOPO → resposta-padrão pré-aprovada
    ├── Motor Determinístico (se substituição):
    │     └── Encontra substituto dentro de constraints, valida escopo CREF
    ├── LLM Call (DeepSeek V3.2 → OpenAI GPT-4.1 → Claude Sonnet 4.5):
    │     ├── Context window: protocolo atual + últimas 10-15 msgs + RAG docs
    │     └── Temperature 0.7, max_tokens 500
    ├── Validação pós-geração:
    │     ├── Sem recomendação médica (regex + LLM classifier)
    │     ├── Dentro de escopo CREF
    │     └── Se falhar: fallback pré-aprovado + flag para admin
    ├── Enqueue "whatsapp-outbound" com mensagem final
    ├── Redis: atualiza histórico da sessão (append ao array de msgs)
    ├── PostgreSQL: salva mensagem no histórico de conversação
    ├── PostHog: evento "ai_coach_response_sent" com latência e model_used
    └── Redis: releaseLock("session:lock:{user_id}")

Latência esperada: 5-20s (well within SLA 30s p95)
```

---

## 4. ADRs — Architecture Decision Records

### ADR-002 — ORM: Drizzle vs. Prisma vs. TypeORM

**Contexto:** O time precisa de um ORM TypeScript com excelente performance, tipo-segurança e suporte a PostgreSQL com PGVector.

**Decisão:** **Drizzle ORM**

**Justificativa:**
- Benchmark independente (tech-insider.org, 2026): Drizzle 10x mais rápido que Prisma em queries complexas
- Em produção: ECOSIRE reporta 4.600 req/s, ~100 tables, ~5K queries/s no pico com Drizzle v7.6.0
- Schema como código TypeScript (sem DSL separado) — menor curva de aprendizado e melhor type inference
- Suporte nativo a extensões PostgreSQL, incluindo PGVector com `sql` template literal
- Zero runtime overhead — queries compiladas diretamente para SQL
- Drizzle v7.3.0 (jan/2026) trouxe compiladores de queries mais rápidos e menores

**Alternativas Consideradas:**
- Prisma — Rejeitado. Performance inferior, Rust binary overhead, queries N+1 fáceis de criar inadvertidamente
- TypeORM — Rejeitado. Decorators frágeis, bugs conhecidos com PostgreSQL migrations, manutenção lenta
- Kyselv + types manuais — Rejeitado. Muito verboso para o estágio atual

**Consequências:** Leonardo (Backend) usará Drizzle. Migrations com `drizzle-kit`. Type-safety end-to-end.

---

### ADR-003 — Connection Pooling: PgBouncer desde o MVP

**Contexto:** NestJS com múltiplos workers BullMQ pode abrir muitas conexões simultâneas ao PostgreSQL. PostgreSQL tem overhead significativo por conexão. VPS Hostinger KVM 2 (8 GB RAM) tem limite prático de ~100 conexões simultâneas.

**Decisão:** **PgBouncer em transaction pooling mode desde o MVP.**

**Justificativa:**
- PgBouncer 1.25.0 (2026) é o padrão de-facto para pooling PostgreSQL
- Transaction mode: a conexão ao servidor é mantida apenas durante uma transação — permite 1000 clientes com apenas 50 conexões ao servidor
- Configuração recomendada: `default_pool_size=50`, `reserve_pool_size=10`, `max_client_conn=200`
- Transparente para a aplicação — NestJS aponta para `localhost:5433` (PgBouncer) em vez de `localhost:5432`
- Prepara para escala horizontal: mais instâncias da aplicação compartilham o mesmo pool

**Atenção:** Transaction mode é incompatível com prepared statements e `LISTEN/NOTIFY`. Drizzle não usa prepared statements por padrão — compatível.

**Consequências:** Henrique (DevOps) configura PgBouncer no Docker Compose. Leonardo não usa `LISTEN/NOTIFY` diretamente — usa Redis Pub/Sub para comunicação assíncrona.

---

### ADR-004 — Redis: Configuração AOF + Sentinel no MVP

**Contexto:** Redis é componente crítico: armazena sessões de chat (memória do AI Coach), locks de processamento, e jobs BullMQ. Perda de dados do Redis significa usuários sem contexto de sessão e jobs perdidos.

**Decisão:** **Redis standalone com AOF (appendonly yes) + 1 replica + Sentinel em produção.**

**Justificativa:**
- AOF (Append-Only File) garante persistência de cada write — recuperação de falha sem perda de sessões
- Redis Sentinel com 3 nós (1 master + 1 replica + 1 sentinel separado) provê failover automático em < 30s
- No VPS Hostinger com um único host: Redis master + replica em Docker Compose, Sentinel como terceiro container
- BullMQ suporta nativamente Redis Sentinel via ioredis
- Para o MVP: RDB + AOF combinados. `appendfsync everysec` (equilíbrio entre performance e durabilidade)

**Alternativas Consideradas:**
- Redis Cluster — Rejeitado para MVP. Complexidade operacional alta; necessário apenas acima de 10GB de dados em Redis
- Valkey (fork Redis) — Considerado. Benchmarks de 2026 mostram Valkey 8.1-9.0 como competitivo. Reservado para Fase 2+ após estabilização do ecosystem BullMQ

**Consequências:** Sato (Security) revisa configuração de TLS do Redis. Henrique (DevOps) implementa persistência e Sentinel no Docker Compose.

---

### ADR-005 — LLM Routing: DeepSeek como Principal com Fallback Cascata

**Contexto:** O custo de LLM é o item mais variável do unit economics. DeepSeek V3.2 custa $0,14/$0,28 por 1M tokens input/output — ~100x mais barato que GPT-5, ~18x mais barato que Claude Sonnet 4.5 ($3/$15). É necessário um fallback confiável pois DeepSeek tem histórico de instabilidade para usuários fora da China.

**Decisão:** **DeepSeek V3.2 → OpenAI GPT-4.1 → Anthropic Claude Sonnet 4.5** (cascata por disponibilidade)

**Justificativa:**
- DeepSeek V3.2 para uso em chat conversacional em português: custo ~10x inferior ao OpenAI GPT-4.1 ($2/$8)
- Cache read do DeepSeek: 98-99% abaixo do preço normal — protocolo de treino (que se repete no contexto) é excelente candidato para cache prefill
- Fallback para GPT-4.1 em < 2s via circuit breaker (não GPT-5 — custo proibitivo $10/$30)
- Fallback final para Claude Sonnet 4.5 se GPT-4.1 também falhar
- Victor (IA) implementará o router de LLM com circuit breaker e métricas por modelo

**Cálculo de custo por usuário/mês (estimativa conservadora):**
- 30 interações/mês × 500 tokens médios output + 1000 tokens input ≈ 45K tokens/mês/usuário
- DeepSeek V3.2: 45K tokens × ($0,28/1M output + $0,14/1M input) ÷ 1M ≈ $0,019/usuário/mês ≈ R$0,11/mês
- Com cache hit de 30%: ~$0,013/usuário/mês ≈ R$0,07/mês

**Consequências:** Victor implementa LLMRouter com circuit breaker, retry com exponential backoff, e logging de modelo usado em cada interação (para auditoria CREF e otimização de custo).

---

### ADR-006 — Autenticação: JWT com Refresh Token Rotation

**Contexto:** O sistema tem dois tipos de usuários: usuários finais (acesso via link mágico ou form token) e profissional CREF (dashboard admin com acesso a dados sensíveis).

**Decisão:** **JWT access token (15min TTL) + Refresh token em httpOnly cookie (30 dias TTL) com rotation automática.**

**Justificativa:**
- Para o dashboard do profissional CREF: sessão com httpOnly cookie é mais segura contra XSS que localStorage
- Refresh token rotation: a cada renovação, o token antigo é invalidado (prevenção de replay attacks)
- Para usuários finais (landing page/formulário): token de sessão de anamnese no banco (`anamnesis_sessions.token`) com 72h de expiração — sem autenticação completa necessária no MVP
- Auth.js v5 integrado com Next.js 15 App Router para o dashboard — suporte nativo a session management
- NestJS backend valida JWT via `@nestjs/passport` + `passport-jwt`

**Consequências:** Sato (Security) revisa a estratégia de rotation e implementação de revogação de tokens.

---

### ADR-007 — Comunicação Frontend-Backend: REST + WebSocket seletivo

**Contexto:** O dashboard do profissional CREF precisa de atualizações em tempo real (novo usuário com flag PAR-Q, protocolo aguardando assinatura). A comunicação principal entre frontend e backend é via REST.

**Decisão:** **REST para operações CRUD + WebSocket (Socket.io) apenas para notificações em tempo real no dashboard.**

**Justificativa:**
- REST com JSON é o padrão correto para 95% das operações (formulário, consulta de protocolos, pagamentos)
- WebSocket apenas para o dashboard admin — canal de notificação unidirecional (server → client)
- Socket.io com adapter Redis para garantir que eventos chegam independente da instância que gerou o evento
- gRPC ou GraphQL adicionariam complexidade sem benefício para o estágio atual

**Consequências:** Felipe (Frontend) implementa Socket.io client apenas no dashboard. Leonardo implementa Socket.io server com Redis adapter.

---

## 5. Arquitetura de IA

### 5.1 Visão Geral — Arquitetura Híbrida

A arquitetura de IA da MOVIVO é deliberadamente **híbrida**: um motor determinístico gerencia o estado de progressão e as regras CREF-safe, e o LLM é responsável exclusivamente pela geração de linguagem natural. Isso garante:

1. **Auditabilidade regulatória:** cada decisão de treino tem uma trilha determinística auditável
2. **Controle de alucinação:** o LLM nunca "inventa" exercícios — apenas descreve o que o motor calculou
3. **Redução de custo:** o contexto injetado no LLM é estruturado e enxuto (~60% menos tokens vs. injetar histórico bruto)
4. **Versionamento independente:** as regras de periodização evoluem sem tocar no código LLM

### 5.2 Motor Determinístico — Especificação Técnica

```typescript
// Domínio central do Motor Determinístico
interface ProtocolState {
  userId: string;
  week: number;           // semana atual do protocolo (1-n)
  phase: TrainingPhase;   // ADAPTACAO | HIPERTROFIA | FORCA | DELOAD
  currentLoad: LoadMatrix; // carga atual por exercício
  constraints: UserConstraints; // lesões, equipamentos, disponibilidade
  parqFlags: PARQFlags;   // contraindicações do PAR-Q
}

interface LoadMatrix {
  [exerciseId: string]: {
    sets: number;
    reps: RepsRange;
    weight: WeightStrategy; // % 1RM, RIR, ou PSE
    restSeconds: number;
  };
}

// Regras de progressão (exemplos):
// - Semana 1-4: adaptação neuromuscular (volume baixo, técnica)
// - Semana 5-12: hipertrofia (dupla progressão: rep → carga)
// - Semana 13-16: força (intensidade alta, volume moderado)
// - Semana 17: deload (50% volume, manutenção de intensidade)
// - Constraint: se PAR-Q flag cardíaco → sem exercícios > 8/10 PSE sem liberação médica
// - Constraint: se lesão ombro → sem press overhead, substituição automática
```

**Implementação:**
- TypeScript puro, sem dependências externas
- Testado extensivamente (Mariana fará cobertura de 100% do motor)
- Versionado com semantic versioning — mudanças nas regras geram nova versão do protocolo
- Output: `ProtocolStructure` (JSON tipado) que o LLM humaniza

### 5.3 Arquitetura de Memória — 3 Camadas

```
┌─────────────────────────────────────────────────────────────────────┐
│                    MEMÓRIA DO AI COACH                              │
│                                                                     │
│  CAMADA 1 — WORKING MEMORY (Redis)                                  │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Chave: session:{user_id}:{date}                            │   │
│  │  TTL: 24 horas (renovado a cada mensagem)                   │   │
│  │  Conteúdo: últimas 10-15 mensagens (chat format)            │   │
│  │  Tamanho: ~3-5 KB por sessão ativa                          │   │
│  │  Propósito: continuidade de conversa dentro do dia          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  CAMADA 2 — EPISODIC MEMORY (PostgreSQL)                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Tabelas: protocols, protocol_versions, conversations,      │   │
│  │           checkins, ai_jobs                                 │   │
│  │  Conteúdo: protocolo atual, semana, ajustes históricos,     │   │
│  │            resultados de check-ins, flags de revisão        │   │
│  │  Propósito: estado persistente entre sessões                │   │
│  │  Acesso: a cada request do AI Coach (via PgBouncer)         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  CAMADA 3 — SEMANTIC MEMORY (PGVector + RAG)                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Índice: HNSW em PGVector (text-embedding-3-small, 1536d)   │   │
│  │  Corpus: literatura científica de treino curada             │   │
│  │          (~500-2000 documentos: estudos, guidelines ACSM)   │   │
│  │  Ativado quando: intenção = DUVIDA_TECNICA                  │   │
│  │  Retorna: top-3 trechos relevantes (max 300 tokens cada)    │   │
│  │  Propósito: embasar respostas técnicas em evidência         │   │
│  │  Performance: HNSW sub-100ms p95 (pgvector benchmark 2026)  │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.4 RAG — Detalhamento Técnico

**Pipeline de indexação (offline, executado pela equipe técnica):**
1. Coleta de literatura: artigos ACSM, NSCA, estudos de hipertrofia (PubMed), guias de periodização
2. Chunking: 512 tokens com overlap de 50 tokens
3. Embedding: `text-embedding-3-small` via OpenAI API (1536 dimensões, $0,02/1M tokens)
4. Armazenamento: PGVector com índice HNSW (`m=16, ef_construction=64`)
5. Metadados: fonte, data_publicacao, topico, confiabilidade (1-5)

**Pipeline de retrieval (em tempo real, durante chat):**
```sql
-- Busca semântica com filtro de tópico e threshold de similaridade
SELECT chunk_text, metadata, 1 - (embedding <=> $1::vector) AS score
FROM knowledge_base
WHERE topic = ANY($2)  -- tópicos relevantes à mensagem
  AND 1 - (embedding <=> $1::vector) > 0.75  -- threshold de relevância
ORDER BY embedding <=> $1::vector
LIMIT 3;
```

**Contexto injetado no LLM (estrutura):**
```
SISTEMA: Você é o AI Coach da MOVIVO. Não prescreva medicamentos ou diagnósticos.
         Personalize apenas dentro do protocolo assinado pelo profissional CREF.

PROTOCOLO ATUAL: [JSON estruturado do protocolo - ~200 tokens]
SEMANA ATUAL: [X de Y]
ÚLTIMA CONVERSA: [10-15 msgs em formato chat - ~500 tokens]
LITERATURA RELEVANTE (se dúvida técnica): [top-3 chunks - ~900 tokens]
MENSAGEM DO USUÁRIO: [mensagem atual]
```

**Custo estimado por chamada:** ~2.000-2.500 tokens input + 300-500 tokens output
- DeepSeek V3.2: ~$0,0004/interação
- Com 30 interações/mês: $0,012/usuário/mês ≈ R$0,07

### 5.5 Validação Pós-Geração — Compliance CREF

```typescript
interface ValidationResult {
  passed: boolean;
  violations: ComplianceViolation[];
  fallbackRequired: boolean;
  humanReviewRequired: boolean;
}

// Checklist de validação (executado em < 100ms localmente)
const COMPLIANCE_RULES = [
  // Regra 1: Sem diagnóstico médico
  {
    pattern: /dor|lesão|inflamação|tendinite|artrose|ruptura/i,
    action: 'FLAG_HUMAN_REVIEW',
    message: 'Resposta menciona condição médica — revisão humana necessária'
  },
  // Regra 2: Sem prescrição médica
  {
    pattern: /tome|use|aplique|medicamento|remédio|analgésico/i,
    action: 'BLOCK_FALLBACK',
    message: 'Resposta inclui linguagem de prescrição médica'
  },
  // Regra 3: Respeito às constraints de PAR-Q
  {
    check: (response, user) => validatePARQConstraints(response, user.parqFlags),
    action: 'BLOCK_FALLBACK',
    message: 'Resposta viola restrição PAR-Q do usuário'
  },
  // Regra 4: Scope CREF (personalização, não prescrição independente)
  {
    check: (response) => !includesIndependentPrescription(response),
    action: 'FLAG_HUMAN_REVIEW',
    message: 'Resposta extrapola escopo de personalização'
  }
];
```

Respostas que falham na validação:
1. Recebem flag `human_review_required = true` no banco
2. Usuário recebe resposta-padrão pre-aprovada pelo profissional CREF
3. Notificação em tempo real no dashboard do profissional (WebSocket)
4. Evento `ai_response_blocked` no PostHog para análise de padrões

---

## 6. Modelagem de Domínio (DDD)

### 6.1 Bounded Contexts

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        BOUNDED CONTEXTS — MOVIVO                        │
│                                                                         │
│  ┌─────────────────────┐    ┌─────────────────────┐                    │
│  │  IDENTITY &         │    │  ONBOARDING &        │                    │
│  │  ACCESS             │    │  ANAMNESIS           │                    │
│  │                     │    │                      │                    │
│  │  User               │    │  AnamnesisSession    │                    │
│  │  AuthSession        │    │  ConsentRecord       │                    │
│  │  Permission         │    │  PARQAssessment      │                    │
│  └─────────────────────┘    └─────────────────────┘                    │
│                                                                         │
│  ┌─────────────────────┐    ┌─────────────────────┐                    │
│  │  TRAINING &         │    │  COACHING &          │                    │
│  │  PROTOCOL           │    │  CONVERSATION        │                    │
│  │                     │    │                      │                    │
│  │  Protocol           │    │  Conversation        │                    │
│  │  ProtocolVersion    │    │  Message             │                    │
│  │  TrainingPhase      │    │  CoachingSession     │                    │
│  │  Exercise (catalog) │    │  AIJobRecord         │                    │
│  │  CheckIn            │    │                      │                    │
│  └─────────────────────┘    └─────────────────────┘                    │
│                                                                         │
│  ┌─────────────────────┐    ┌─────────────────────┐                    │
│  │  SUBSCRIPTION &     │    │  COMPLIANCE &        │                    │
│  │  BILLING            │    │  AUDIT               │                    │
│  │                     │    │                      │                    │
│  │  Subscription       │    │  AuditLog            │                    │
│  │  PaymentEvent       │    │  ProtocolSignature   │                    │
│  │  TrialPeriod        │    │  ComplianceFlag      │                    │
│  │  ConversionSeq      │    │  DataSubjectRequest  │                    │
│  └─────────────────────┘    └─────────────────────┘                    │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Agregados Principais

**Agregado: Protocol**
```
Protocol (raiz do agregado)
├── id: UUID
├── userId: UUID (referência ao contexto Identity)
├── version: number (incrementa a cada ajuste)
├── status: DRAFT | PENDING_SIGNATURE | ACTIVE | SUPERSEDED
├── professionalId: UUID (profissional CREF que assinou)
├── signedAt: timestamp | null
├── phases: TrainingPhase[]
│   └── TrainingPhase
│       ├── phaseType: ADAPTACAO | HIPERTROFIA | FORCA | DELOAD
│       ├── weekStart: number
│       ├── weekEnd: number
│       └── sessions: TrainingSession[]
│           └── TrainingSession
│               ├── dayOfWeek: number
│               └── exercises: ExerciseAssignment[]
│                   └── ExerciseAssignment
│                       ├── exerciseId: UUID (catalog)
│                       ├── sets: number
│                       ├── repsMin: number
│                       ├── repsMax: number
│                       └── notes: string
├── constraints: ProtocolConstraints (imutável após criação)
└── events: DomainEvent[] (para event sourcing parcial)
```

**Eventos de Domínio:**
```
ProtocolCreated
ProtocolSignedByProfessional
ProtocolActivated
ProtocolAdjusted (pelo check-in)
ProtocolSuperseded (nova versão criada)
CheckInReceived
CheckInProcessed
ConversionSequenceStarted (dia 7 de trial)
SubscriptionCreated
SubscriptionCancelled
PAR-QFlagRaised (requer revisão humana)
AIResponseBlocked (validação falhou)
```

### 6.3 Value Objects Críticos

```typescript
// Constraints imutáveis do usuário — nunca muda dentro de um protocolo
class ProtocolConstraints {
  constructor(
    readonly availableDays: DayOfWeek[],       // ex: ['MON', 'WED', 'FRI']
    readonly equipment: Equipment[],            // ex: ['BARBELL', 'DUMBBELL']
    readonly location: TrainingLocation,        // ACADEMIA | CASA | PARQUE
    readonly injuries: InjuryRecord[],         // lesões com restrições
    readonly parqFlags: PARQFlag[],            // contraindicações do PAR-Q
    readonly fitnessLevel: FitnessLevel,       // INICIANTE | INTERMEDIARIO | AVANCADO
    readonly primaryGoal: TrainingGoal         // EMAGRECIMENTO | HIPERTROFIA | CONDICIONAMENTO
  ) {}

  hasRestrictionFor(exercise: Exercise): boolean { ... }
  allowsCardiacIntensity(pse: number): boolean { ... }
}

// Identificador de sessão de anamnese — token único por usuário
class AnamnesisToken {
  private constructor(readonly value: string) {}
  static generate(): AnamnesisToken { return new AnamnesisToken(crypto.randomUUID()); }
  static from(value: string): AnamnesisToken { /* valida formato */ }
}
```

---

## 7. Estratégia de Banco de Dados

### 7.1 PostgreSQL — Schema Principal (DDL)

```sql
-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";  -- pgvector

-- =====================================================================
-- TABELA: users
-- =====================================================================
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone_number    VARCHAR(20) NOT NULL UNIQUE,  -- E.164 format: +5511999999999
  name            VARCHAR(255),
  email           VARCHAR(255) UNIQUE,
  whatsapp_name   VARCHAR(255),
  status          VARCHAR(20) NOT NULL DEFAULT 'ONBOARDING'
                  CHECK (status IN ('ONBOARDING', 'TRIAL', 'ACTIVE', 'CHURNED', 'PAUSED')),
  trial_started_at TIMESTAMPTZ,
  trial_ends_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_users_phone ON users(phone_number);
CREATE INDEX idx_users_status ON users(status);

-- =====================================================================
-- TABELA: anamnesis_sessions
-- =====================================================================
CREATE TABLE anamnesis_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  token           VARCHAR(64) NOT NULL UNIQUE,  -- link de retorno
  status          VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS'
                  CHECK (status IN ('IN_PROGRESS', 'SUBMITTED', 'EXPIRED', 'PROCESSED')),
  last_block      SMALLINT NOT NULL DEFAULT 1,  -- 1, 2 ou 3
  data_block_1    JSONB,  -- dados básicos + objetivo
  data_block_2    JSONB,  -- histórico de saúde + PAR-Q (dados sensíveis)
  data_block_3    JSONB,  -- disponibilidade + equipamentos
  primary_goal    VARCHAR(30),  -- pré-qualifying da landing page
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '72 hours'),
  submitted_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_anamnesis_token ON anamnesis_sessions(token);
CREATE INDEX idx_anamnesis_user ON anamnesis_sessions(user_id);

-- =====================================================================
-- TABELA: consents (LGPD — registros de consentimento)
-- =====================================================================
CREATE TABLE consents (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  consent_type    VARCHAR(50) NOT NULL,
                  -- 'DATA_PROCESSING', 'HEALTH_DATA', 'MARKETING', 'TERMS_OF_SERVICE'
  version         VARCHAR(20) NOT NULL,  -- versão dos termos aceitos
  accepted        BOOLEAN NOT NULL,
  ip_address      INET,
  user_agent      TEXT,
  accepted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ,
  UNIQUE (user_id, consent_type, version)
);
CREATE INDEX idx_consents_user ON consents(user_id);

-- =====================================================================
-- TABELA: protocols
-- =====================================================================
CREATE TABLE protocols (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  version         SMALLINT NOT NULL DEFAULT 1,
  status          VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
                  CHECK (status IN ('DRAFT', 'PENDING_SIGNATURE', 'ACTIVE', 'SUPERSEDED', 'ARCHIVED')),
  professional_id UUID,  -- profissional CREF que assinou
  signed_at       TIMESTAMPTZ,
  signature_hash  VARCHAR(64),  -- SHA-256 do conteúdo no momento da assinatura
  current_week    SMALLINT NOT NULL DEFAULT 1,
  total_weeks     SMALLINT NOT NULL DEFAULT 12,
  content         JSONB NOT NULL,  -- estrutura completa do protocolo
  constraints     JSONB NOT NULL,  -- ProtocolConstraints imutável
  par_q_flags     JSONB,           -- flags de contraindicação do PAR-Q
  human_review_required BOOLEAN NOT NULL DEFAULT FALSE,
  generated_by    VARCHAR(50),  -- 'DEEPSEEK_V3_2' | 'GPT_4_1' | etc.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, version)
);
CREATE INDEX idx_protocols_user ON protocols(user_id);
CREATE INDEX idx_protocols_status ON protocols(status);
CREATE INDEX idx_protocols_review ON protocols(human_review_required) WHERE human_review_required = TRUE;

-- =====================================================================
-- TABELA: conversations
-- =====================================================================
CREATE TABLE conversations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  protocol_id     UUID REFERENCES protocols(id),
  direction       VARCHAR(10) NOT NULL CHECK (direction IN ('INBOUND', 'OUTBOUND')),
  message_type    VARCHAR(20) NOT NULL DEFAULT 'TEXT'
                  CHECK (message_type IN ('TEXT', 'IMAGE', 'AUDIO', 'TEMPLATE', 'SYSTEM')),
  content         TEXT NOT NULL,
  whatsapp_msg_id VARCHAR(255) UNIQUE,  -- ID da mensagem na API AraraHQ
  ai_job_id       UUID,  -- referência ao job que gerou esta resposta
  model_used      VARCHAR(50),  -- modelo LLM utilizado (se OUTBOUND gerado por IA)
  latency_ms      INTEGER,  -- latência de geração da resposta
  validation_passed BOOLEAN,  -- resultado da validação de compliance
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
PARTITION BY RANGE (created_at);  -- particionamento mensal

-- Partições iniciais
CREATE TABLE conversations_2026_07 PARTITION OF conversations
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE conversations_2026_08 PARTITION OF conversations
  FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
-- Criar partições futuras mensalmente (script automatizado)

CREATE INDEX idx_conversations_user_date ON conversations(user_id, created_at DESC);
CREATE INDEX idx_conversations_whatsapp_id ON conversations(whatsapp_msg_id);

-- =====================================================================
-- TABELA: checkins
-- =====================================================================
CREATE TABLE checkins (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  protocol_id     UUID NOT NULL REFERENCES protocols(id),
  week_number     SMALLINT NOT NULL,
  sent_at         TIMESTAMPTZ,
  responded_at    TIMESTAMPTZ,
  responses       JSONB,  -- respostas às 3 perguntas do check-in
  adjustments     JSONB,  -- ajustes aplicados ao protocolo
  new_protocol_id UUID REFERENCES protocols(id),  -- se gerou nova versão
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_checkins_user ON checkins(user_id, week_number);

-- =====================================================================
-- TABELA: subscriptions
-- =====================================================================
CREATE TABLE subscriptions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  plan            VARCHAR(20) NOT NULL CHECK (plan IN ('BASICO', 'PRO')),
  price_cents     INTEGER NOT NULL,  -- preço em centavos
  currency        VARCHAR(3) NOT NULL DEFAULT 'BRL',
  status          VARCHAR(20) NOT NULL DEFAULT 'TRIAL'
                  CHECK (status IN ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'PAUSED')),
  payment_provider VARCHAR(10) CHECK (payment_provider IN ('STRIPE', 'ASAAS')),
  external_sub_id VARCHAR(255),  -- ID da assinatura no Stripe/Asaas
  trial_end       TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  cancelled_at    TIMESTAMPTZ,
  cancel_reason   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_trial_end ON subscriptions(trial_end)
  WHERE status = 'TRIAL';

-- =====================================================================
-- TABELA: ai_jobs (audit trail de jobs de IA)
-- =====================================================================
CREATE TABLE ai_jobs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  job_type        VARCHAR(30) NOT NULL
                  CHECK (job_type IN ('PROTOCOL_GENERATION', 'AI_RESPONSE', 'CHECKIN_ADJUSTMENT')),
  queue_name      VARCHAR(50) NOT NULL,
  bullmq_job_id   VARCHAR(255),
  status          VARCHAR(20) NOT NULL DEFAULT 'QUEUED'
                  CHECK (status IN ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'DLQ')),
  input_snapshot  JSONB NOT NULL,   -- snapshot do contexto no momento do job
  output_snapshot JSONB,            -- resultado gerado
  model_used      VARCHAR(50),
  tokens_input    INTEGER,
  tokens_output   INTEGER,
  latency_ms      INTEGER,
  error_message   TEXT,
  retry_count     SMALLINT DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);
CREATE INDEX idx_ai_jobs_user ON ai_jobs(user_id, created_at DESC);
CREATE INDEX idx_ai_jobs_status ON ai_jobs(status) WHERE status IN ('QUEUED', 'PROCESSING', 'FAILED');

-- =====================================================================
-- TABELA: knowledge_base (RAG corpus)
-- =====================================================================
CREATE TABLE knowledge_base (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_url      TEXT,
  title           TEXT,
  chunk_text      TEXT NOT NULL,
  topic           VARCHAR(50),  -- 'HIPERTROFIA' | 'CARDIO' | 'PERIODIZACAO' | etc.
  reliability     SMALLINT CHECK (reliability BETWEEN 1 AND 5),
  embedding       vector(1536),  -- text-embedding-3-small
  published_at    DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Índice HNSW para busca de similaridade (pgvector)
CREATE INDEX idx_kb_embedding ON knowledge_base
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
CREATE INDEX idx_kb_topic ON knowledge_base(topic);

-- =====================================================================
-- TABELA: audit_logs (trilha de auditoria imutável)
-- =====================================================================
CREATE TABLE audit_logs (
  id              BIGSERIAL PRIMARY KEY,  -- BIGSERIAL para inserção rápida
  user_id         UUID,
  actor_id        UUID,    -- quem executou (usuário, profissional, sistema)
  actor_type      VARCHAR(20) CHECK (actor_type IN ('USER', 'PROFESSIONAL', 'SYSTEM', 'AI')),
  action          VARCHAR(100) NOT NULL,
  entity_type     VARCHAR(50),
  entity_id       UUID,
  changes         JSONB,
  ip_address      INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- NUNCA permitir UPDATE ou DELETE nesta tabela
-- Row-Level Security: apenas INSERT e SELECT para a aplicação
CREATE INDEX idx_audit_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX idx_audit_entity ON audit_logs(entity_type, entity_id);
```

### 7.2 Índices Críticos Adicionais

```sql
-- Índice composto para check-ins semanais (query mais frequente do scheduler)
CREATE INDEX idx_active_trial_users ON subscriptions(trial_end, user_id)
  WHERE status = 'TRIAL' AND trial_end > NOW();

-- Índice para conversão (dias 7, 10, 13, 14 após trial_started_at)
CREATE INDEX idx_conversion_sequence ON users(trial_started_at, id)
  WHERE status = 'TRIAL';

-- Índice parcial para protocolos pendentes de assinatura
CREATE INDEX idx_pending_protocols ON protocols(created_at, user_id)
  WHERE status = 'PENDING_SIGNATURE';
```

### 7.3 Estratégia de Particionamento

- **`conversations`**: Particionamento por range de `created_at` (mensal). Esta é a tabela de maior volume — ao final de 12 meses com 5.000 usuários ativos fazendo 30 interações/mês, teremos ~1,8M de registros. Particionamento mensal mantém cada partição em ~150K registros e permite DROP de partições antigas para compliance LGPD (direito ao esquecimento).
- **`audit_logs`**: BIGSERIAL para inserção máxima. Crescerá rapidamente. Particionamento trimestral na Fase 2.

### 7.4 Redis — Estrutura de Dados

```
# Sessão de chat (Working Memory do AI Coach)
session:{user_id}:{date}          → LIST de mensagens (JSON) — TTL 24h

# Lock de processamento por usuário
session:lock:{user_id}             → "1" com TTL 60s

# Debounce de webhook
webhook:debounce:{user_id}         → "1" com TTL 3s

# Cache de protocolo ativo (para não ir ao banco a cada mensagem)
protocol:active:{user_id}          → JSON do protocolo — TTL 1h (invalidado no check-in)

# Rate limiting de saída WhatsApp
whatsapp:rate:global               → Counter com sliding window 1s — limite 80/s

# Fila de mensagens por usuário (sequenciamento)
queue:user:{user_id}               → LIST de job IDs pendentes (processados em ordem)

# Controle de trial - cache para scheduler
trial:expiring:{date}              → SET de user_ids com trial expirando naquela data
```

---

## 8. Estratégia de Filas e Processamento Assíncrono

### 8.1 Arquitetura de Filas BullMQ

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     FILAS BULLMQ — MOVIVO                               │
│                                                                         │
│  FILA: protocol-generation                                              │
│  ├── Concorrência: 5 workers                                            │
│  ├── Lock duration: 120s (geração pode demorar até 60s)                │
│  ├── Attempts: 3 (backoff exponencial: 2s, 8s, 32s)                   │
│  ├── removeOnComplete: { count: 100 }                                  │
│  ├── removeOnFail: false (manter para debug)                           │
│  └── Dead Letter Queue: protocol-generation:failed                     │
│                                                                         │
│  FILA: ai-response                                                      │
│  ├── Concorrência: 20 workers                                           │
│  ├── Lock duration: 45s                                                 │
│  ├── Attempts: 2 (backoff: 3s, 9s)                                     │
│  ├── Priority: por user tier (pago > trial)                            │
│  ├── Rate limiting: 80 jobs/s (limitado pelo WhatsApp rate limit)     │
│  ├── removeOnComplete: { count: 1000, age: 3600 }                     │
│  └── Dead Letter Queue: ai-response:failed                             │
│                                                                         │
│  FILA: whatsapp-outbound                                                │
│  ├── Concorrência: 10 workers (limitado pelo rate limit AraraHQ)      │
│  ├── Lock duration: 30s                                                 │
│  ├── Attempts: 5 (backoff exponencial agressivo)                       │
│  ├── Rate limiting: 80 jobs/s (global, com throttler Redis)            │
│  ├── removeOnComplete: { count: 500, age: 1800 }                      │
│  └── Dead Letter Queue: whatsapp-outbound:failed                       │
│                                                                         │
│  FILA: checkin-weekly                                                   │
│  ├── Concorrência: 10 workers                                           │
│  ├── Schedule: cron "0 8 * * MON" (América/São_Paulo)                 │
│  ├── Spread: adiciona delay aleatório de 0-7200s (spread 2h)          │
│  ├── Attempts: 3                                                        │
│  └── Dead Letter Queue: checkin-weekly:failed                          │
│                                                                         │
│  FILA: conversion-sequence                                              │
│  ├── Concorrência: 5 workers                                            │
│  ├── Jobs: delayed jobs para dias 7, 10, 13, 14 do trial              │
│  ├── Scheduled via BullMQ delayed jobs com timestamp preciso           │
│  └── Dead Letter Queue: conversion-sequence:failed                     │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8.2 Worker Implementation Pattern

```typescript
// Padrão de implementação de workers (referência para Leonardo)
@Injectable()
export class AIResponseWorker extends WorkerHost {
  constructor(
    private readonly contextService: ContextService,
    private readonly deterministicEngine: DeterministicEngine,
    private readonly llmRouter: LLMRouter,
    private readonly validationService: ValidationService,
    private readonly whatsappQueue: Queue,
    private readonly telemetry: TelemetryService,
  ) {
    super();
  }

  @Process()
  async process(job: Job<AIResponseJobData>): Promise<AIResponseResult> {
    const span = this.telemetry.startSpan('ai_response_worker', {
      userId: job.data.userId,
      jobId: job.id,
    });

    try {
      // 1. Carregar contexto (3 camadas)
      const context = await this.contextService.loadContext(job.data.userId);
      
      // 2. Classificar intenção
      const intent = await this.classifyIntent(job.data.message, context);
      
      // 3. Motor determinístico (se substituição de exercício)
      if (intent === MessageIntent.EXERCISE_SUBSTITUTION) {
        const substitution = this.deterministicEngine.findSubstitute(
          job.data.exerciseId,
          context.constraints,
        );
        context.substitution = substitution;
      }

      // 4. RAG (se dúvida técnica)
      if (intent === MessageIntent.TECHNICAL_QUESTION) {
        context.ragDocs = await this.ragService.retrieve(job.data.message, { limit: 3 });
      }

      // 5. LLM call com circuit breaker
      const rawResponse = await this.llmRouter.complete({
        context,
        message: job.data.message,
        maxTokens: 500,
        temperature: 0.7,
      });

      // 6. Validação de compliance
      const validation = await this.validationService.validate(rawResponse, context.user);
      
      let finalResponse = rawResponse;
      if (!validation.passed) {
        finalResponse = this.validationService.getFallbackResponse(intent);
        await this.flagForHumanReview(job.data.userId, rawResponse, validation.violations);
      }

      // 7. Enqueue para saída WhatsApp
      await this.whatsappQueue.add('send-message', {
        userId: job.data.userId,
        message: finalResponse,
        jobId: job.id,
      });

      span.setStatus({ code: SpanStatusCode.OK });
      return { success: true, validationPassed: validation.passed };
      
    } catch (error) {
      span.recordException(error);
      throw error; // BullMQ vai fazer retry
    } finally {
      span.end();
    }
  }
}
```

### 8.3 Dead Letter Queue — Estratégia

```typescript
// Handler de DLQ (referência para Leonardo)
@Injectable()
export class DLQProcessor {
  // Jobs na DLQ são processados separadamente
  // Objetivo: não perder nenhuma interação de usuário

  async handleProtocolGenerationDLQ(job: Job) {
    // 1. Alertar equipe via Sentry
    this.sentry.captureMessage(`Protocol generation failed after retries`, {
      extra: { userId: job.data.userId, attempts: job.attemptsMade }
    });
    
    // 2. Enviar mensagem de fallback ao usuário via WhatsApp
    await this.whatsappService.sendTemplate(job.data.userId, 'protocol_delay', {
      estimatedTime: '30 minutos'
    });
    
    // 3. Marcar para revisão manual no dashboard
    await this.adminService.createManualTask({
      type: 'PROTOCOL_GENERATION_FAILED',
      userId: job.data.userId,
      priority: 'HIGH',
    });
  }

  async handleAIResponseDLQ(job: Job) {
    // 1. Enviar resposta-padrão ao usuário
    await this.whatsappService.sendTemplate(job.data.userId, 'ai_coach_unavailable');
    
    // 2. Log de auditoria
    await this.auditService.log({
      action: 'AI_RESPONSE_DLQ',
      userId: job.data.userId,
      details: { error: job.failedReason }
    });
  }
}
```

---

## 9. Arquitetura de APIs

### 9.1 Contratos REST — Endpoints Principais

```
BASE URL: https://api.movivo.app/v1

MÓDULO: Anamnesis
POST   /anamnesis/start              → Inicia sessão, retorna token
GET    /anamnesis/session/{token}    → Retoma sessão, retorna último bloco
PATCH  /anamnesis/session/{token}/block/{n}  → Salva bloco n (1, 2 ou 3)
POST   /anamnesis/session/{token}/submit     → Submete formulário completo

MÓDULO: Webhook (AraraHQ)
POST   /webhook/whatsapp             → Recebe mensagens do WhatsApp
POST   /webhook/stripe               → Recebe eventos do Stripe
POST   /webhook/asaas                → Recebe eventos do Asaas

MÓDULO: Protocol (autenticado)
GET    /protocols/{userId}/active    → Protocolo ativo do usuário
GET    /protocols/{userId}/history   → Histórico de versões
POST   /protocols/{protocolId}/sign  → Profissional CREF assina o protocolo

MÓDULO: Admin / CREF Dashboard (autenticado, role=PROFESSIONAL)
GET    /admin/protocols/pending-signature  → Lista protocolos aguardando assinatura
GET    /admin/flags                         → Lista flags de revisão humana
POST   /admin/flags/{flagId}/resolve       → Resolve flag (aprova/edita resposta)
GET    /admin/users                         → Lista usuários ativos
GET    /admin/users/{userId}/timeline      → Timeline completa do usuário

MÓDULO: Subscriptions (autenticado)
POST   /subscriptions/checkout       → Inicia checkout (Stripe ou Asaas)
POST   /subscriptions/cancel         → Cancela assinatura

MÓDULO: Auth
POST   /auth/login                   → Login (profissional CREF)
POST   /auth/refresh                 → Renova access token
POST   /auth/logout                  → Invalida refresh token
```

### 9.2 Versionamento de API

- **v1**: MVP completo
- **v2**: Quando houver breaking changes (migração gradual com suporte a ambas por 90 dias)
- Headers: `API-Version: 1.0` retornado em todas as respostas
- Deprecation: header `Sunset: date` em endpoints v1 deprecados

### 9.3 Autenticação e Autorização

```
Endpoint               Auth Required    Roles Permitidos
─────────────────────────────────────────────────────────
POST /anamnesis/*      Não (token UUID) N/A
POST /webhook/*        HMAC signature   N/A (sistema AraraHQ/Stripe/Asaas)
GET  /protocols/*      JWT              USER, PROFESSIONAL, ADMIN
POST /protocols/*/sign JWT              PROFESSIONAL
GET  /admin/*          JWT              PROFESSIONAL, ADMIN
POST /subscriptions/*  JWT              USER
POST /auth/*           Público          N/A
```

### 9.4 Rate Limiting por Endpoint

```
/webhook/whatsapp      → 1000 req/min por IP (Cloudflare WAF + NestJS ThrottlerGuard)
/anamnesis/*           → 60 req/min por IP
/auth/login            → 10 req/min por IP (proteção contra brute force)
/admin/*               → 300 req/min por usuário autenticado
/subscriptions/*       → 30 req/min por usuário
```

### 9.5 Contrato do Webhook AraraHQ

```typescript
// Estrutura do payload de entrada (inbound message)
interface AraraHQWebhookPayload {
  event: 'message' | 'message_status' | 'connection_update';
  data: {
    messageId: string;
    from: string;          // E.164: "+5511999999999"
    to: string;            // número MOVIVO
    timestamp: number;     // Unix timestamp
    type: 'text' | 'image' | 'audio' | 'document';
    text?: { body: string };
    image?: { caption?: string; id: string };
    audio?: { id: string };
  };
  signature: string;       // HMAC-SHA256 do payload com secret AraraHQ
}

// Validação obrigatória ANTES de processar qualquer payload
function validateAraraHQSignature(payload: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

---

## 10. Estratégia de Escalabilidade

### 10.1 Capacidade do MVP — VPS Hostinger KVM 2

```
Hardware: 2 vCPU AMD EPYC, 8 GB RAM, 100 GB NVMe
Serviços em Docker Compose:
  - Next.js (SSR): ~300 MB RAM, 0.5 vCPU
  - NestJS Backend: ~400 MB RAM, 1 vCPU
  - PostgreSQL + PgBouncer: ~2 GB RAM, 0.5 vCPU
  - Redis + Sentinel: ~500 MB RAM
  - BullMQ Workers (embutido no NestJS): sem overhead adicional
  - Prometheus + Grafana + Loki: ~600 MB RAM
  Total estimado: ~4 GB RAM utilizados de 8 GB disponíveis

Capacidade estimada com esta infra:
  - Usuários ativos simultâneos: ~500
  - Messages/hora: ~3.000
  - Protocol generations/hora: ~200
  - Custo VPS: ~R$75/mês (KVM 2 renovação)
```

### 10.2 Caminho de Escalabilidade — 3 Fases

**Fase A — VPS Otimizado (MVP → 2.000 usuários ativos)**
- Upgrade para KVM 4 (4 vCPU, 16 GB RAM, ~R$175/mês) se necessário
- Redis replica dedicada (segundo VPS)
- Read replica PostgreSQL para queries do dashboard
- Gatilho: CPU > 70% por > 15 min OU p95 latência AI Coach > 25s

**Fase B — Cloud Híbrido (2.000 → 15.000 usuários ativos)**
- Migração do backend NestJS para Kubernetes (K8s) gerenciado (EKS/GKE)
- PostgreSQL → RDS PostgreSQL Multi-AZ OU Supabase Enterprise
- Redis → ElastiCache Redis (Multi-AZ)
- BullMQ workers em pods separados com HPA (Horizontal Pod Autoscaler)
- Cloudflare já presente — permanece como CDN e WAF
- Custo estimado: ~R$2.500-4.000/mês

**Fase C — Cloud Nativo (15.000+ usuários)**
- Extração de módulos como microservices cirurgicamente:
  1. `whatsapp-gateway` (primeiro — maior isolamento necessário)
  2. `ai-engine` (segundo — permite escalar workers independentemente)
  3. `protocol-service` (terceiro — isolamento do motor determinístico)
- CQRS completo com event sourcing para audit trail
- Multi-region se expansão para outros países (Latam)

### 10.3 Estateless por Desenho

Todos os containers são **stateless por design**:
- Estado de sessão: Redis (externo)
- Estado persistente: PostgreSQL (externo)
- Configuração: variáveis de ambiente (não hardcoded)
- Secrets: Docker Secrets ou Vault (Fase B)

Isso garante que adicionar uma segunda instância do NestJS não requer nenhuma mudança de arquitetura.

---

## 11. Estratégia de Segurança

> Detalhamento completo a ser desenvolvido por Sato. Aqui estão os controles arquiteturais definidos pela arquitetura.

### 11.1 Isolamento de Dados por Usuário — Tenant Isolation

**O risco:** vazamento de dados de treino de usuário A para usuário B via:
1. Cache Redis sem namespace por usuário
2. Query SQL sem filtro `user_id` explícito
3. Contexto de sessão BullMQ compartilhado entre jobs

**Controles arquiteturais:**
```typescript
// 1. Todas as chaves Redis são SEMPRE prefixadas com user_id
// ERRADO: redis.set('session', data)
// CERTO:
redis.set(`session:${userId}:${date}`, data, 'EX', 86400);

// 2. Todos os repositórios Drizzle passam userId como filtro obrigatório
// O tipo UserScopedQuery força o parâmetro em compile time
type UserScopedQuery<T> = (userId: UUID, ...args: any[]) => Promise<T>;

// 3. Row-Level Security no PostgreSQL (segunda linha de defesa)
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_isolation ON conversations
  USING (user_id = current_setting('app.current_user_id')::UUID);

// 4. Jobs BullMQ nunca compartilham estado entre usuários diferentes
// Cada job recebe userId explicitamente e não usa variáveis globais
```

### 11.2 Proteção de Dados Sensíveis (LGPD Art. 11)

- **Dados do formulário de anamnese** (bloco 2 — saúde): criptografia em repouso com pgcrypto
- **Número de telefone**: considerado dado pessoal — não logado em texto claro nos logs de aplicação
- **PAR-Q flags**: armazenado como JSONB criptografado; acesso apenas pelo profissional CREF e sistema
- **Logs de auditoria**: imutáveis, retidos por 5 anos (requisito LGPD para dados de saúde)
- **Direito ao esquecimento**: `DELETE FROM conversations WHERE user_id = $1` + DROP de partição mensal garante remoção; `audit_logs` mantidos sem PII após anonimização

### 11.3 Segurança de API

```
Cloudflare WAF → Nginx (proxy reverso) → NestJS
  ↓
Controles por camada:
1. Cloudflare: DDoS protection, bot management, WAF rules (OWASP Top 10)
2. Nginx: rate limiting por IP, SSL termination, headers de segurança
3. NestJS Guards: JWT validation, RBAC, HMAC validation (webhooks)
4. Drizzle ORM: parametrized queries (SQL injection impossível por design)
5. Zod: input validation em todos os DTOs (rejeição de payloads malformados)
```

### 11.4 Secrets Management

```
MVP: Docker Secrets + .env files (nunca commitados)
Fase B: HashiCorp Vault ou AWS Secrets Manager

Secrets rotacionados:
- AraraHQ webhook secret
- Stripe/Asaas webhook secrets
- JWT signing key (rotação mensal)
- Redis password
- PostgreSQL password
- LLM API keys (DeepSeek, OpenAI, Anthropic)
```

---

## 12. Estratégia de Observabilidade

### 12.1 OpenTelemetry — Spans Críticos

```typescript
// Instrumentação recomendada (todos os spans a seguir são obrigatórios)

// Span 1: Webhook recebido até job enqueued
'webhook.received' → 'debounce.check' → 'lock.acquired' → 'job.enqueued'
Atributos: userId, messageType, webhookResponseMs

// Span 2: Job dequeued até resposta enviada
'worker.started' → 'context.loaded' → 'intent.classified' → 
  'rag.retrieved' (se técnico) → 'llm.called' → 'validation.passed/failed' →
  'whatsapp.enqueued'
Atributos: userId, modelUsed, tokensInput, tokensOutput, latencyMs, validationPassed

// Span 3: Protocol generation end-to-end
'protocol.queued' → 'motor.calculated' → 'llm.called' → 'validation.checked' →
  'protocol.saved' → 'whatsapp.sent'
Atributos: userId, protocolVersion, generationTimeMs, modelUsed

// Span 4: Check-in semanal
'checkin.triggered' → 'checkin.sent' → 'checkin.responded' → 'protocol.adjusted'
Atributos: userId, weekNumber, adjustmentsMade
```

### 12.2 SLIs, SLOs e SLAs

| SLI | SLO (Target) | SLA (Garantia) | Alerta Crítico |
|-----|-------------|----------------|----------------|
| Disponibilidade da API | 99,95% mensal | 99,9% mensal | < 99,9% |
| Latência AI Coach p95 | ≤ 20s | ≤ 30s | > 25s por 5min |
| Latência confirmação formulário | ≤ 2s | ≤ 5s | > 3s p99 |
| Protocolo entregue em 2h | 99% dos casos | 95% p95 | Fila > 50 jobs |
| Check-in disparado na janela | 100% segunda-feira 08-10h | 99,5% | Job atrasado > 30min |
| Jobs na DLQ | < 0,1% | < 0,5% | > 5 jobs DLQ/hora |
| Respostas bloqueadas por compliance | < 2% | < 5% | > 3% em 1h |

### 12.3 Alertas Críticos (Grafana)

```yaml
# Alertas que disparam PagerDuty/Telegram imediatamente

- name: AI Coach Latency Critical
  condition: p95(ai_response_latency_ms) > 25000 for 5m
  action: PagerDuty P1

- name: Webhook Response Slow
  condition: p99(webhook_response_ms) > 3000 for 2m
  action: PagerDuty P2

- name: DLQ Jobs Spike
  condition: rate(dlq_jobs_total[5m]) > 1
  action: Slack #engineering + PagerDuty P2

- name: Redis Down
  condition: redis_up == 0 for 30s
  action: PagerDuty P1 (Sentinel deve fazer failover em < 30s)

- name: LLM Primary Failing
  condition: rate(llm_errors_total{provider="deepseek"}[5m]) > 5
  action: Slack #engineering (circuit breaker já ativo)

- name: WhatsApp Rate Limit Hit
  condition: whatsapp_rate_limit_rejections_total > 0
  action: Slack #engineering

- name: High Compliance Violation Rate
  condition: rate(ai_response_blocked_total[1h]) / rate(ai_responses_total[1h]) > 0.03
  action: Slack #product + @cref-professional
```

### 12.4 Eventos PostHog Obrigatórios

```typescript
// Todos os eventos definidos por Lucas — mapeamento para implementação
const POSTHOG_EVENTS = {
  // Onboarding funnel
  'form_started':          { props: ['primaryGoal', 'source'] },
  'form_block_completed':  { props: ['blockNumber', 'timeSpentMs'] },
  'form_abandoned':        { props: ['blockNumber', 'lastField'] },
  'form_submitted':        { props: ['totalTimeMs', 'parqFlagsCount'] },
  
  // Protocol pipeline
  'protocol_queued':       { props: ['userId', 'anamnesisId'] },
  'protocol_generated':    { props: ['userId', 'timeMs', 'modelUsed'] },
  'protocol_sent':         { props: ['userId', 'totalPipelineMs'] },
  
  // Engagement
  'whatsapp_first_message_sent_by_user': { props: ['userId', 'hoursAfterProtocol'] },
  'first_workout_confirmed': { props: ['userId', 'dayOfWeek'] },
  
  // Check-in
  'checkin_sent':          { props: ['userId', 'weekNumber'] },
  'checkin_responded':     { props: ['userId', 'weekNumber', 'responseTimeHours'] },
  
  // Conversion
  'conversion_message_sent': { props: ['userId', 'dayOfTrial'] },  // dias 7, 10, 13, 14
  'subscription_created':   { props: ['userId', 'plan', 'price', 'provider'] },
  'subscription_cancelled': { props: ['userId', 'reason', 'daysSinceStart'] },
};
```

---

## 13. Impacto em Performance

### 13.1 Latência por Operação

| Operação | Componentes | Latência Estimada | SLA |
|----------|-------------|-------------------|-----|
| POST /anamnesis/block | NestJS + Drizzle + PostgreSQL | 50-150ms | ≤ 500ms |
| POST /webhook/whatsapp | NestJS controller + Redis SET | 100-200ms | ≤ 500ms |
| BullMQ enqueue | Redis LPUSH via BullMQ | 2-5ms | ≤ 10ms |
| Context load (3 layers) | Redis GET + PostgreSQL SELECT + PGVector | 80-200ms | ≤ 500ms |
| Motor determinístico | TypeScript puro, CPU-bound | 5-20ms | ≤ 100ms |
| RAG query (PGVector HNSW) | PostgreSQL HNSW vector search | 20-60ms | ≤ 100ms |
| LLM call (DeepSeek V3.2) | API externa, network | 2-10s | ≤ 20s |
| Validação compliance | Regex + rule engine | 10-50ms | ≤ 200ms |
| WhatsApp outbound (AraraHQ) | API externa, network | 200-800ms | ≤ 2s |
| **Total AI Coach p50** | **Sum acima** | **~5-12s** | **≤ 20s** |
| **Total AI Coach p95** | **Sum + overhead** | **~15-22s** | **≤ 30s** |

### 13.2 Throughput Esperado

```
MVP com VPS KVM 2 (2 vCPU, 8 GB RAM):
- Concurrent BullMQ workers (ai-response): 20
- Throughput ai-response: ~2.400 respostas/hora
- Para 5.000 usuários ativos × 1 msg/dia = 5.000 msg/dia = ~208 msg/hora
- Headroom: 10x acima da demanda esperada no MVP

Bottleneck esperado: LLM API (DeepSeek) — não o sistema interno
Mitigação: pool de conexões ao LLM API com timeout de 20s e circuit breaker
```

### 13.3 Benchmarks de Referência

- **NestJS**: 8.500-12.000 QPS (benchmarks 2026, tech-insider.org)
- **Drizzle ORM**: 4.600 req/s com p95 ≤ 100ms em PostgreSQL (ecosire.com, produção)
- **BullMQ**: 27.200 jobs/s de pico; 911-8.300 jobs/s com processamento real (bullmq.io)
- **PGVector HNSW**: sub-100ms p95 em queries de similaridade com até 1M vetores (instaclustr.com)
- **Redis Sentinel failover**: < 30s (configuração padrão com down-after-milliseconds = 10000)

---

## 14. Impacto em Custos (FinOps)

### 14.1 Custo por Usuário/Mês — MVP

| Componente | Custo Unitário | Por Usuário/Mês | Notas |
|------------|----------------|-----------------|-------|
| VPS KVM 2 | R$75/mês | R$0,015 para 5K usuários | Custo fixo |
| DeepSeek V3.2 (AI Coach) | $0,14/$0,28 por 1M tokens | ~R$0,07 | 30 interações × 1.500 tokens médios |
| DeepSeek V3.2 (Protocol gen) | $0,14/$0,28 por 1M tokens | ~R$0,03 | 1 geração × 4.000 tokens |
| OpenAI (embeddings RAG) | $0,02 por 1M tokens | ~R$0,001 | Indexação offline, custo único |
| AraraHQ WhatsApp | ~R$0,10-0,15/usuário/mês | R$0,10-0,15 | Verificar planos AraraHQ |
| Asaas (PIX) | 2,5% por transação | R$0,75-1,47 | Para R$29-59/mês |
| Stripe (cartão BR) | 3,4% + R$0,40 | R$1,38-2,40 | Para R$29-59/mês |
| **Total custo variável** | | **~R$2,30-4,10** | |

### 14.2 Unit Economics Resumido

```
Receita por usuário (plano básico R$29/mês):
- Custo variável: R$2,30
- Margem bruta: R$26,70 = 92%

Receita por usuário (plano pro R$59/mês):
- Custo variável: R$4,10 (Stripe/Asaas mais caro na alíquota)
- Margem bruta: R$54,90 = 93%

Breakeven VPS (KVM 2, R$75/mês de infra):
- ~100 usuários pagos (cobrem apenas infra)
- Com 500 usuários pagos: R$13.350/mês de receita, ~R$2.300 em custos variáveis

Ponto de migração para cloud:
- Financeiramente: quando o custo adicional de cloud (~R$2.500/mês) é menor que
  o risco de downtime com VPS único
- Tecnicamente: ~2.000-3.000 usuários ativos simultâneos
```

### 14.3 Otimizações de Custo LLM

1. **Cache prefill DeepSeek**: o protocolo de treino fica no início do contexto — cache hit de 30-50% reduz custo em ~40%
2. **Batch API** (check-ins): usar batch API do DeepSeek (quando disponível) para check-ins — 50% de desconto
3. **Temperatura 0 para validação**: usar modelo menor (DeepSeek V4 Flash $0,14/$0,28) apenas para classificação de intenção
4. **Comprimir histórico de chat**: em vez de passar 15 mensagens brutas, sumarizar sessões antigas com LLM no check-in semanal (custo único, reduz tokens diários)

---

## 15. Riscos Técnicos e Mitigações

| # | Risco | Probabilidade | Impacto | Mitigação |
|---|-------|---------------|---------|-----------|
| R-01 | DeepSeek instabilidade/latência alta | Média | Alto | Circuit breaker → fallback GPT-4.1 → Claude Sonnet em < 2s |
| R-02 | Redis single point of failure (MVP) | Baixa | Crítico | AOF + replica + Sentinel; BullMQ com retry automático |
| R-03 | AraraHQ rate limit (80 msg/s) atingido | Baixa (MVP) | Médio | BullMQ rate limiter + throttling + dead letter queue |
| R-04 | Explosão de custo LLM por usuário abusivo | Baixa | Médio | Rate limit por usuário (max 50 msgs/dia) + alertas de gasto |
| R-05 | Violação LGPD — vazamento de dados sensíveis | Muito Baixa | Crítico | RLS no PostgreSQL + namespace Redis + audit log imutável + Sato |
| R-06 | Alucinação LLM em prescrição de exercício | Média | Alto | Validação pós-geração + fallback pré-aprovado + flag CREF |
| R-07 | Formulário abandono > 50% | Média | Alto | Salvamento automático entre blocos + token de retorno por WhatsApp |
| R-08 | Cold start containers > 5s | Baixa | Médio | Healthcheck + `SIGTERM` graceful shutdown em NestJS |
| R-09 | Migration de banco em produção sem downtime | Média | Alto | Drizzle migrations com `--no-lock` + migrations backwards-compatible |
| R-10 | PgBouncer transaction mode incompatível | Média | Médio | Eliminar `LISTEN/NOTIFY` e prepared statements; usar Redis Pub/Sub |

---

## 16. Roadmap de Implementação

### Ordem Recomendada de Desenvolvimento

```
SPRINT 0 — Fundação (1 semana)
  □ Repositório monorepo (apps/web, apps/api, packages/shared)
  □ Docker Compose: PostgreSQL + PgBouncer + Redis + Sentinel
  □ NestJS boilerplate com módulos vazios e contratos de interface
  □ Drizzle schema + primeira migration (tabelas core)
  □ CI/CD básico com GitHub Actions (lint, test, build)
  □ Variáveis de ambiente e secrets management

SPRINT 1 — Core de Usuário e Anamnese (2 semanas)
  □ Módulo AUTH: JWT + refresh token
  □ Módulo ANAMNESIS: formulário em 3 blocos com salvamento
  □ Módulo CONSENT: LGPD consent registro
  □ Next.js: Landing page + formulário conversacional
  □ BullMQ: setup inicial de filas

SPRINT 2 — Pipeline de Protocolo (2 semanas)
  □ Motor Determinístico: implementação e testes (100% coverage)
  □ LLMRouter: DeepSeek + fallbacks + circuit breaker
  □ Worker: ProtocolGenerationWorker completo
  □ Integração AraraHQ: envio de protocolo formatado
  □ PostHog: eventos de onboarding

SPRINT 3 — AI Coach (2 semanas)
  □ WebhookController: validação HMAC + debounce + lock
  □ Worker: AIResponseWorker completo
  □ ContextService: 3 camadas de memória
  □ ValidationService: checklist compliance CREF
  □ PGVector: indexação do corpus RAG inicial
  □ RAGService: retrieval pipeline

SPRINT 4 — Conversão e Billing (1 semana)
  □ Módulo SUBSCRIPTION: Stripe + Asaas
  □ Worker: ConversionSequenceWorker (dias 7, 10, 13, 14)
  □ Webhooks de pagamento: Stripe + Asaas
  □ PostHog: eventos de conversão

SPRINT 5 — Check-in e Dashboard CREF (2 semanas)
  □ Worker: CheckinWeeklyWorker + scheduler cron
  □ Ajuste de protocolo pós-check-in
  □ Dashboard Next.js para profissional CREF
  □ WebSocket: notificações em tempo real
  □ Módulo AUDIT: log imutável + assinatura eletrônica

SPRINT 6 — Observabilidade e Hardening (1 semana)
  □ OpenTelemetry: instrumentação completa
  □ Prometheus + Grafana + Loki: dashboards e alertas
  □ Sentry: error tracking
  □ Testes de carga (Mariana): validar SLAs
  □ Security review (Sato): penetration testing básico

TOTAL ESTIMADO: ~11 semanas para MVP completo com 3 devs
```

---

## 17. Próximos Passos por Agente

### Para Sato (Engenheiro de Segurança)

Receba este relatório e aprofunde as seguintes áreas:
1. **Threat model completo**: modelar ameaças específicas do sistema WhatsApp + IA + dados de saúde
2. **Row-Level Security PostgreSQL**: implementar e validar as políticas de isolamento por usuário
3. **Rotação de secrets**: implementar política e processo de rotação de chaves (AraraHQ, JWT, LLM APIs)
4. **HMAC validation AraraHQ**: validar a implementação e adicionar replay protection (timestamp em payload)
5. **LGPD data mapping**: mapear todas as categorias de dados e fluxos para o RIPD
6. **Audit log imutável**: garantir que a tabela `audit_logs` seja append-only com permissões de banco
7. **TLS Redis**: configurar TLS na comunicação entre NestJS e Redis (mesmo na VPS — defense in depth)
8. **Pentest de anamnese**: testar injeção via campos do formulário e escalada de privilégio via token UUID

### Para Victor (Engenheiro de IA)

Receba este relatório e implemente:
1. **LLMRouter com circuit breaker**: DeepSeek → GPT-4.1 → Claude Sonnet, com métricas por modelo
2. **ContextService**: implementação das 3 camadas de memória (Redis + PostgreSQL + PGVector)
3. **Intent classifier**: classificação eficiente de intenção (pode ser regex + LLM leve)
4. **RAG pipeline**: indexação do corpus inicial + retrieval com HNSW + filtro de threshold
5. **Prompt engineering**: templates de prompt para cada tipo de intenção (DUVIDA_TECNICA, SUBSTITUICAO, MOTIVACAO)
6. **ValidationService**: checklist de compliance CREF com fallback seguro
7. **LLMOps**: logging de tokens, custo e model_used em cada chamada para otimização contínua
8. **Avaliação de qualidade**: framework de avaliação de respostas (accuracy + safety score)

### Para Leonardo (Engenheiro Backend)

Receba este relatório e implemente:
1. **Estrutura do monólito modular**: módulos NestJS com contratos explícitos (sem import circular)
2. **Drizzle schema + migrations**: DDL do relatório como ponto de partida (adaptar e expandir)
3. **PgBouncer**: configurar em Docker Compose com `default_pool_size=50`, transaction mode
4. **BullMQ**: implementar todas as 5 filas com os parâmetros especificados na seção 8
5. **WebhookController**: HMAC validation + debounce Redis + lock por user_id
6. **AuditService**: tabela `audit_logs` append-only com triggers PostgreSQL para garantir imutabilidade
7. **Módulo de assinaturas**: integração Stripe (internacional) + Asaas (PIX) com idempotência em webhooks
8. **Graceful shutdown**: `SIGTERM` handler no NestJS para drenagem de workers BullMQ antes de encerrar

### Para Felipe (Engenheiro Frontend)

Receba este relatório e implemente:
1. **Next.js 15 App Router**: estrutura de rotas para landing page, formulário, dashboard CREF
2. **Formulário conversacional**: 3 blocos com salvamento automático via `PATCH /anamnesis/session/{token}/block/{n}`
3. **Retomada de sessão**: lógica para retomar formulário incompleto via token (link de retorno)
4. **Dashboard CREF**: listagem de protocolos pendentes, flags, timeline de usuário
5. **Socket.io client**: notificações em tempo real no dashboard (flags PAR-Q, novos protocolos)
6. **PostHog integration**: eventos de funil de onboarding (form_started, form_block_completed, form_abandoned)
7. **Performance**: RSC para landing page (redução de 30-50% de JS client-side); streaming SSR no formulário
8. **Design system**: integração com "O Pulso" (Kimura) usando Tailwind + shadcn/ui configurado com as cores/tokens

### Para Mariana (Analista de QA)

Receba este relatório e implemente:
1. **100% coverage do Motor Determinístico**: este é o componente mais crítico — toda regra de periodização e constraint deve ter teste unitário
2. **Testes de isolamento de usuário**: testes de integração que verificam vazamento de dados entre usuários (Redis + PostgreSQL)
3. **Testes de compliance**: pipeline de validação pós-geração deve ter 100% de cobertura para cada regra CREF
4. **Testes de carga**: simular 500 usuários simultâneos enviando mensagens → validar SLA de 30s p95
5. **Testes de BullMQ**: simular falhas de Redis durante processamento, validar retry e DLQ
6. **Testes de webhook**: simular payloads malformados, assinaturas inválidas, rate limit da Meta
7. **Testes de check-in semanal**: validar que o cron dispara no horário correto (timezone São Paulo)
8. **Quality gates CI**: bloquear merge se coverage < 80% global e < 100% no Motor Determinístico

### Para Henrique (Engenheiro de Plataforma / DevOps)

Receba este relatório e implemente:
1. **Docker Compose completo**: todos os serviços com healthchecks, restart policies e resource limits
2. **PgBouncer**: container com `pgbouncer.ini` configurado para transaction mode
3. **Redis Sentinel**: 3 containers (master + replica + sentinel) com configuração de quorum=2
4. **Redis AOF**: `appendonly yes` + `appendfsync everysec` para durabilidade
5. **GitHub Actions CI/CD**: pipeline lint → test → build → deploy com zero-downtime rolling update
6. **Cloudflare**: configuração de WAF rules, rate limiting por IP, proteção do endpoint `/webhook/whatsapp`
7. **Observabilidade**: Prometheus + Grafana (dashboards predefinidos) + Loki (log aggregation) + Sentry
8. **Backup PostgreSQL**: `pg_dump` diário via cron para armazenamento externo (S3-compatible); testar restore mensalmente
9. **Monitoramento de certificados TLS**: alerta 30 dias antes do vencimento

---

## 18. Fontes Consultadas

1. [Top Choices for TypeScript Backend Framework in 2026 — Medium](https://medium.com/@priya.raimagiya/top-choices-for-typescript-backend-framework-in-2026-4c9b6ab56eb1)
2. [NestJS vs FastAPI 2026: Performance Benchmarks — Emporionsoft](https://emporionsoft.com/nestjs-vs-fastapi-2026/)
3. [NestJS vs Next.js 2026: 180K vs 65K Stars and 70% Speed Gap — Tech Insider](https://tech-insider.org/nestjs-vs-nextjs-2026/)
4. [BullMQ Architecture for High Traffic: Queue Isolation and Redis Clustering — Markaicode](https://markaicode.com/architecture/bullmq-high-traffic-scalability-architecture/)
5. [BullMQ vs Bull: Feature Comparison 2026 — OneUptime](https://oneuptime.com/blog/post/2026-01-21-bullmq-vs-bull/view)
6. [BullMQ Articles & Benchmarks — BullMQ Official](https://bullmq.io/articles/)
7. [pgvector: Key features, tutorial, and pros and cons [2026 guide] — Instaclustr](https://www.instaclustr.com/education/vector-database/pgvector-key-features-tutorial-and-pros-and-cons-2026-guide/)
8. [pgvector performance: Benchmark results and 5 ways to boost performance — Instaclustr](https://www.instaclustr.com/education/vector-database/pgvector-performance-benchmark-results-and-5-ways-to-boost-performance/)
9. [pgvector PostgreSQL: HNSW Indexing & Production Setup [2026] — DBADataverse](https://dbadataverse.com/tech/postgresql/2025/12/pgvector-postgresql-vector-database-guide)
10. [LLM API Pricing Comparison Jul 2026 — CostGoat](https://costgoat.com/compare/llm-api)
11. [AI API Pricing Comparison 2026: OpenAI vs Anthropic vs Google vs DeepSeek — TokenCostCalc](https://tokencostcalc.com/blog/openai-vs-anthropic-vs-google-pricing-2026.html)
12. [WhatsApp API 2026 Updates: Portfolio Pacing, 100K Messaging Limits — WozTell](https://woztell.com/whatsapp-api-2026-updates-pacing-limits-usernames/)
13. [WhatsApp API Rate Limits: Avoid Blocks and Grow Faster in 2026 — Webmaxy](https://www.webmaxy.co/blog/whatsapp-business-api/whatsapp-api-rate-limits-avoid-blocks-and-grow-faster-in-2026/)
14. [Building WhatsApp Business Bots with the Official API: Architecture, Webhooks — DEV Community](https://dev.to/achiya-automation/building-whatsapp-business-bots-with-the-official-api-architecture-webhooks-and-automation-1ce4)
15. [Drizzle vs Prisma in 2026: 66 Production Schemas — Ecosire](https://ecosire.com/blog/drizzle-orm-vs-prisma-2026-comparison)
16. [Drizzle vs Prisma: 10x Faster Queries? [2026 Benchmarks] — Tech Insider](https://tech-insider.org/drizzle-vs-prisma-2026/)
17. [Drizzle ORM Benchmarks — Official](https://orm.drizzle.team/benchmarks)
18. [How to Use Connection Pooling with PgBouncer — OneUptime](https://oneuptime.com/blog/post/2026-01-25-use-connection-pooling-pgbouncer/view)
19. [PgBouncer - lightweight connection pooler for PostgreSQL — Official](https://www.pgbouncer.org/)
20. [Redis Sentinel Configuration Best Practices — OneUptime](https://oneuptime.com/blog/post/2026-03-31-redis-sentinel-configuration-best-practices/view)
21. [High availability with Redis Sentinel — Redis Official Docs](https://redis.io/docs/latest/operate/oss_and_stack/management/sentinel/)
22. [Next.js App Router Best Practices for Production (2026) — JavaScriptDoctor](https://www.javascriptdoctor.blog/2026/07/nextjs-app-router-best-practices-for.html)
23. [OpenTelemetry NestJS Guide: Distributed Tracing in Production (2026) — AppScale Blog](https://appscale.blog/en/blog/opentelemetry-nestjs-distributed-tracing-production-2026)
24. [NestJS OpenTelemetry Instrumentation: TypeORM & BullMQ Tracing — base14 Scout](https://docs.base14.io/instrument/apps/auto-instrumentation/nestjs/)
25. [Hostinger VPS Pricing & Review 2026: KVM Plans — BestUSAVPS](https://bestusavps.com/reviews/hostinger-vps/)
26. [Stripe Pix Recurring Payments Support — Stripe Documentation](https://docs.stripe.com/changelog/dahlia/2026-04-22/pix-recurring-payments-support)
27. [Asaas API Integration: Payments, Pix & Billing for Brazil — MCPMarket](https://mcpmarket.com/server/asaas)
28. [NestJS Authentication Guide 2026 — Encore](https://encore.dev/articles/nestjs-authentication-guide)
29. [PostgreSQL as a Vector Database: When to Use pgvector vs Pinecone vs Weaviate — DEV Community](https://dev.to/polliog/postgresql-as-a-vector-database-when-to-use-pgvector-vs-pinecone-vs-weaviate-4kfi)
30. [Integrating Fine-Tuning and RAG for Healthcare AI Systems — MDPI](https://www.mdpi.com/2306-5354/13/2/225)

---

*Relatório gerado por Rafael Nakamura — Distinguished Software Architect*
*Data: 2026-07-22 | Versão: 1.0 | Próxima revisão: após feedback de Sato e Victor*

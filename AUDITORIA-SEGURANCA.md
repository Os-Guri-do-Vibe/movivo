# Auditoria de Segurança — MOVIVO

**Auditor:** Gabriel Sato (Distinguished Security Engineer / Principal Security Architect)
**Data:** 2026-09-18
**Alvo:** monorepo `movivo` — working tree em `main` (commit base `c24683e`, incluindo alterações não commitadas)
**Tipo:** auditoria técnica ad-hoc (fora do pipeline de criação de startup)
**Classificação do relatório:** INTERNO — cita caminhos de arquivos de segredo e cenários de exploração

> Nenhum sistema é 100% seguro. Este relatório mede o quão caro está um ataque contra a MOVIVO hoje, e onde esse custo caiu perto de zero.

---

## 1. Resumo executivo

A MOVIVO tem uma postura de segurança **acima da média para um MVP pré-lançamento** — substancialmente acima do que normalmente se encontra em startups nesta fase. O código demonstra maturidade real e não cosmética:

- **Isolamento multi-tenant genuíno e em profundidade**: RLS `FORCE` no PostgreSQL com GUC por transação (`set_config(..., is_local := true)`), corretamente desenhado para sobreviver ao PgBouncer em *transaction mode* — e, além da RLS, **todo** query de domínio repete o predicado `eq(tabela.userId, userId)` na aplicação. Não encontrei um único IDOR explorável.
- **Autenticação sólida**: JWT RS256 com `algorithms` fixo (recusa `alg:none`/HS256), seleção de chave por `kid` com rotação N/N-1, denylist por `jti` no Redis, revalidação do papel contra o banco, refresh opaco de 256 bits armazenado apenas como hash SHA-256, comparação em tempo constante, Argon2id com *dummy hash* contra enumeração de usuários.
- **Zero segredos vazados no Git**: nenhum `.env`, chave privada ou credencial jamais foi commitado. `.gitignore` é rigoroso, `gitleaks` roda sobre o histórico completo no CI, e a allowlist do gitleaks é por regex específica (não por caminho amplo).
- **Sem SQL injection**: todo `sql.unsafe` está confinado ao caminho de migração com constantes hardcoded; todo dado de request vai parametrizado.
- **DevSecOps real no CI**: gitleaks (histórico completo) + semgrep (OWASP Top Ten) + `pnpm audit --audit-level=high`, todos bloqueantes, com `permissions: contents: read` por padrão.
- **Defesas de IA acima do estado da arte de mercado**: envelope de dado não confiável, delimitação estrutural do input, neutralização de padrões de injeção, anti-leak de system prompt, PII scrubber inescapável na porta do router, confinamento estrutural do SDK de provedor testado automaticamente.

**Porém**, encontrei **dois achados CRÍTICOS** que anulam garantias centrais do produto:

1. **Bypass de autenticação no webhook de pagamento.** O factory do gateway cai silenciosamente num `MockGateway` cujo segredo HMAC está **hardcoded em claro no código-fonte**. Qualquer pessoa com acesso ao repositório pode forjar um evento de pagamento e ativar assinatura paga para qualquer usuário — ou cancelar a de um pagante.
2. **Todos os gates de dado de saúde foram ligados em `true`** em `apps/api/.env`, enviando anamnese, PAR-Q e dor clínica para DeepSeek (jurisdição chinesa), OpenAI, Anthropic e Groq sem o DPA, a base de transferência internacional e o atestado de não-treinamento que o próprio ADR-005-R2 exige como pré-condição. O controle em código está correto e é fail-closed; **a configuração o derrotou**.

O padrão é claro e vale registrar: **a engenharia de segurança deste projeto é forte; a governança de configuração é o elo fraco.** Os dois achados críticos não são bugs de código — são controles corretos desativados por configuração e por um caminho de fallback conveniente demais.

### Contagem por severidade

| Severidade | Quantidade |
|---|---|
| 🔴 **CRÍTICO** | 2 |
| 🟠 **ALTO** | 5 |
| 🟡 **MÉDIO** | 9 |
| 🔵 **BAIXO** | 5 |
| ⚪ **INFORMATIVO / HARDENING** | 6 |
| **Total** | **27** |

---

## 2. Escopo avaliado

### Efetivamente analisado

| Área | Cobertura |
|---|---|
| `apps/api/src/**` | Leitura direcionada de ~60 arquivos: bootstrap, config/env schema, auth (guards, estratégia JWT, tokens, senha), RLS/tenant DB, cifra pgcrypto, logger/redação, LLM router e providers, RAG/contexto, prompt injection, webhooks WhatsApp (AraraHQ + Evolution), webhook de pagamento e gateways, workout/journal/access, anamnese, account/avatar, admin/control-center, short-link |
| `apps/web/src/**` | BFF do dashboard, sessão/cookies, proxy/CSP, rotas de API (avatar, control catch-all, workout, session), `next.config.ts`, componentes novos de share-card |
| `packages/shared/src/**` | Schemas Zod compartilhados (uso nos boundaries) |
| Segredos | `git log --all --full-history --diff-filter=A` sobre todo o histórico; `.gitignore`; `.gitleaks.toml`; inspeção de `.env`, `apps/api/.env`, `apps/web/.env.local`, `secrets/` (nomes e permissões; **valores não foram lidos nem exfiltrados**) |
| Dependências | `pnpm audit` executado com sucesso; versões resolvidas conferidas em `node_modules/.pnpm` |
| CI/CD | `.github/workflows/ci.yml` integral |
| Infra | `docker-compose.yml` (bindings de porta, `security_opt`), ausência de Dockerfile |
| Pesquisa externa | Advisories Next.js jul/ago 2026, npm advisories (qs, esbuild), verificação de reputação do pacote `js-rich-body-highlighter` |

### Limitações declaradas — o que NÃO foi possível verificar

Sou explícito sobre os limites desta auditoria, porque um relatório que esconde seus pontos cegos é pior que nenhum:

1. **Sem acesso a produção.** Não há infraestrutura de produção provisionada que eu pudesse inspecionar. Não sei quais valores de env estão em produção, se há WAF/Cloudflare na frente, se o TLS está terminado com HSTS no proxy reverso, nem como os Docker Secrets são materializados fora do laptop. Achados de header e de configuração podem já estar mitigados na borda — **mas não pude confirmar, e um controle que não consigo verificar não conta como controle**.
2. **Não li o conteúdo dos segredos.** Inspecionei `secrets/` apenas por nome, tamanho e permissão. Os arquivos contêm chaves de API reais (tamanhos compatíveis com chaves vivas de DeepSeek, OpenAI, Anthropic, Groq, AraraHQ), mas não extraí valores.
3. **Sem teste dinâmico.** Esta é uma auditoria de código estático + configuração. Não executei DAST, fuzzing, nem exploração ativa contra uma instância viva. Os cenários de exploração descritos são derivados da leitura do código e são, na minha avaliação, exploráveis — mas **não foram provados em runtime**.
4. **`semgrep` não foi executado localmente** (roda apenas em container no CI). Apoiei-me em leitura manual, que é mais profunda porém menos exaustiva em cobertura de padrões.
5. **Não auditei `metodologia.md`, `sprint/`, `docs/`** quanto a conteúdo sensível, nem o histórico de branches remotos além de `main`.
6. **Gateways de pagamento reais não existem ainda** (são stubs que lançam). Portanto não pude auditar a verificação de assinatura real de Stripe/Asaas — ela ainda não foi escrita.

---

## 3. 🔴 CRÍTICO

### C-01 — Bypass de autenticação no webhook de pagamento via fallback silencioso para `MockGateway` com segredo hardcoded

**Vulnerabilidade:** OWASP A07:2021 (Identification and Authentication Failures) + A05:2021 (Security Misconfiguration) + CWE-798 (Use of Hard-coded Credentials). Bypass de autenticação na superfície de escrita financeira.

**Local:**
- `apps/api/src/modules/subscription/payment/mock-gateway.ts:27` — `export const MOCK_WEBHOOK_SECRET = 'mock-webhook-secret-dev';`
- `apps/api/src/modules/subscription/subscription.module.ts:41-48` — factory do `PAYMENT_GATEWAY`
- `apps/api/src/core/config/env.schema.ts:392` — `PAYMENT_PROVIDER: z.enum([...]).default('MOCK')`
- `apps/api/src/modules/subscription/payment-webhook.controller.ts:76` — rota pública `POST /api/v1/webhook/payment`

**Como é explorável / que brecha abre:**

O factory do gateway tem um caminho de fallback incondicional:

```ts
// subscription.module.ts:41-48
if (p.provider === 'STRIPE' && p.stripeSecretKey) { return new StripeGateway(...); }
if (p.provider === 'ASAAS'  && p.asaasApiKey)    { return new AsaasGateway(...); }
// Default/fallback: MOCK (sem credencial real). Boot nunca quebra por falta de chave.
return new MockGateway(logger);
```

O fallback dispara em **três** cenários, e nenhum deles quebra o boot:

1. `PAYMENT_PROVIDER` ausente do env de produção → o schema Zod **default é `'MOCK'`**;
2. `PAYMENT_PROVIDER=STRIPE` mas `STRIPE_SECRET_KEY` ausente, com typo, ou não materializada pelo Docker Secret;
3. Qualquer erro de ordem de carregamento que deixe a chave `undefined` no momento do factory.

Em qualquer um deles, o endpoint **público e não autenticado** `POST /api/v1/webhook/payment` passa a validar HMAC contra a string `'mock-webhook-secret-dev'` — que está **em claro no código-fonte, versionada no Git**, e que qualquer pessoa com acesso ao repositório (os 5 fundadores, qualquer futuro contratado, qualquer vazamento do repo, qualquer ferramenta de IA com acesso ao código) conhece.

Pior: após a verificação de assinatura, `parseWebhookEvent` faz `JSON.parse(rawBody) as GatewayEvent` **sem nenhuma validação de schema** (`mock-gateway.ts:86`). O atacante controla integralmente `type`, `userId`, `plan`, `priceCents`, `amountCents` e `externalSubscriptionId`. E `SubscriptionService.applyGatewayEvent` (`subscription.service.ts:146-147`) confia em `event.userId` diretamente.

**Cadeia de ataque concreta:**

```
Atacante (qualquer um na internet que conheça o segredo do código)
  1. Descobre um userId — UUID; obtido via vazamento, bug de enumeração,
     ou sendo ele próprio um usuário em trial que lê o próprio id.
  2. body = {"type":"CHECKOUT_CONFIRMED","eventId":"evt_"+rand,
             "userId":"<alvo>","externalSubscriptionId":"sub_"+rand,
             "plan":"ANNUAL","priceCents":34900}
  3. ts  = Math.floor(Date.now()/1000)
  4. sig = HMAC-SHA256('mock-webhook-secret-dev', `${ts}.${body}`)
  5. POST /api/v1/webhook/payment
       x-payment-signature: <sig>
       x-payment-timestamp: <ts>
  → 200 OK. Assinatura ANUAL ativada. Receita R$0.
```

**Impacto:**
- **Fraude de receita direta** — assinatura vitalícia gratuita para si e para quem quiser, em escala. O modelo de negócio inteiro é B2C por assinatura: este é o cofre.
- **Negação de serviço contra pagantes** — forjar `SUBSCRIPTION_CANCELED` ou `PAYMENT_FAILED` para o `userId` de qualquer cliente pagante derruba o acesso dele e dispara a régua de dunning por WhatsApp (dano reputacional direto, cliente recebe cobrança indevida).
- **Envenenamento do livro-razão financeiro** — `PaymentReconciliationWorker` grava `amountCents`/`feeCents` controlados pelo atacante em `payments`, tabela imutável por trigger. A contabilidade (Eduardo) passa a operar sobre dados forjados, e a imutabilidade garante que o lixo **não pode ser corrigido**, só compensado.
- **Enumeração de titulares** — `applyGatewayEvent` devolve `NO_SUBSCRIPTION` vs. transição aplicada, criando um oráculo que distingue UUID válido de inválido.

**Probabilidade de exploração:** **Alta** no cenário 1/2 (esquecer uma env var no primeiro deploy é o erro mais comum que existe), e o produto ainda não foi a produção — ou seja, **esse deploy ainda não aconteceu**, o que é exatamente o momento certo de corrigir.

**Correção completa:**

**(a) Fail-closed no factory — nunca cair em MOCK fora de dev:**

```ts
// apps/api/src/modules/subscription/subscription.module.ts
useFactory: (config: AppConfigService, logger: PinoLogger): PaymentGateway => {
  const p = config.payment;

  if (p.provider === 'STRIPE') {
    if (!p.stripeSecretKey || !p.stripeWebhookSecret) {
      throw new InvalidConfigurationError(
        'PAYMENT_PROVIDER=STRIPE exige STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET.',
      );
    }
    return new StripeGateway(p.stripeSecretKey, p.stripeWebhookSecret);
  }
  if (p.provider === 'ASAAS') {
    if (!p.asaasApiKey || !p.asaasWebhookSecret) {
      throw new InvalidConfigurationError(
        'PAYMENT_PROVIDER=ASAAS exige ASAAS_API_KEY e ASAAS_WEBHOOK_SECRET.',
      );
    }
    return new AsaasGateway(p.asaasApiKey, p.asaasWebhookSecret);
  }

  // MOCK só existe fora de produção. Em produção, boot FALHA — nunca degrada em silêncio.
  if (config.isProduction) {
    throw new InvalidConfigurationError(
      'PAYMENT_PROVIDER=MOCK é proibido em produção (gateway sem cobrança real).',
    );
  }
  logger.warn('gateway de pagamento em modo MOCK — nenhuma cobrança real (dev/CI)');
  return new MockGateway(logger);
},
```

**(b) Remover o default permissivo do schema.** Em `env.schema.ts:392`, trocar `.default('MOCK')` por obrigatório-sob-produção via `superRefine`, no mesmo padrão já usado para `API_CORS_ORIGINS` (`env.schema.ts:429`):

```ts
PAYMENT_PROVIDER: z.enum(['MOCK', 'STRIPE', 'ASAAS']).default('MOCK'),
// ...no superRefine existente:
if (config.APP_ENV === 'production' && config.PAYMENT_PROVIDER === 'MOCK') {
  ctx.addIssue({
    code: 'custom',
    path: ['PAYMENT_PROVIDER'],
    message: 'PAYMENT_PROVIDER=MOCK é proibido em produção — defina STRIPE ou ASAAS.',
  });
}
```

**(c) Tirar o segredo hardcoded do código.** Mesmo sendo dev-only, um segredo literal no fonte é uma bomba-relógio de copiar-e-colar. Gerar por ambiente:

```ts
// mock-gateway.ts
export const MOCK_WEBHOOK_SECRET =
  process.env.MOCK_WEBHOOK_SECRET ?? randomBytes(32).toString('hex');
```
Para os testes, injetar o segredo explicitamente no construtor do `MockGateway` em vez de importar a constante.

**(d) Validar o evento com Zod** — ver **A-01**, que é a segunda metade desta correção e vale mesmo depois do Stripe real entrar.

**(e) Verificação operacional:** adicionar ao `/health` (ou a um endpoint de readiness interno) um campo `paymentGateway: 'STRIPE' | 'ASAAS'` para que um monitor detecte imediatamente se a produção subiu em MOCK.

---

### C-02 — Todos os gates de dado de saúde ligados em `true` sem a diligência exigida pelo ADR-005-R2 (LGPD Art. 11 + Art. 33)

**Vulnerabilidade:** Violação de controle de conformidade / transferência internacional de dado pessoal sensível sem base legal. LGPD Art. 11 (dado de saúde), Art. 33 (transferência internacional), Art. 46 (medidas de segurança). OWASP LLM06 (Sensitive Information Disclosure).

**Local:**
- `apps/api/.env:111` — `LLM_OPENAI_HEALTH_DATA_APPROVED=true`
- `apps/api/.env:115` — `LLM_ANTHROPIC_HEALTH_DATA_APPROVED=true`
- `apps/api/.env:119` — `LLM_DEEPSEEK_HEALTH_DATA_APPROVED=true`
- `apps/api/.env:125` — `KNOWLEDGE_OPENAI_EMBEDDING_HEALTH_DATA_APPROVED=true`
- `apps/api/.env:209` — `STT_OPENAI_HEALTH_DATA_APPROVED=true`
- `apps/api/.env:219` — `STT_GROQ_HEALTH_DATA_APPROVED=true`
- Controle correto (não é o bug): `apps/api/src/modules/ai-coach/llm/providers.ts:56-58, 121-123, 240-242` e `llm-router.service.ts:159-165`

**Como é explorável / que brecha abre:**

Este achado merece um enquadramento preciso, porque **o código está certo**. O gate é exemplar:

```ts
// providers.ts:240-242 — fail-closed por construção
canProcess(dataClass: DataClass): boolean {
  return dataClass === 'NON_HEALTH' || this.healthDataApproved;  // default = false
}
```
```ts
// llm-router.service.ts:120 — fail-safe na classificação
const dataClass: DataClass = request.dataClass ?? 'HEALTH';
// llm-router.service.ts:159 — bloqueio ANTES de qualquer byte sair
if (!provider.canProcess(dataClass)) { /* pula o provedor */ }
```

Implementação correta, defensiva, testada. **E derrotada por seis linhas de configuração.**

O ADR-005-R2 e o `CLAUDE.md` afirmam: *"Nenhum endpoint recebe `HEALTH` até aprovação explícita de DPA, transferência internacional, retenção/no-training, suboperadores e segurança."* Cada uma dessas flags é um **atestado formal de que essa diligência foi concluída**. Nenhuma evidência de DPA assinado, cláusulas-padrão de transferência internacional, ou atestado de não-treinamento existe no repositório.

Consequência prática, **hoje, em ambiente de desenvolvimento com dados reais** (a memória do projeto registra protocolos gerados a partir da anamnese real do fundador):

- **Anamnese completa, PAR-Q integral e descrição de dor clínica** — os dados que o próprio schema marca como `LGPD Art. 11 — DADO SENSÍVEL DE SAÚDE` (`anamnesis-sessions.ts:51-60`) — são enviados para a **DeepSeek, provedor sob jurisdição da República Popular da China**, como candidato primário da cascata.
- **Áudio de voz do titular** vai para Groq e OpenAI (STT) — voz é biometria.
- **Embeddings** derivados de conteúdo de saúde vão para a OpenAI.

O PII Scrubber (`llm-router.service.ts:137-140`) remove identificadores diretos (nome, telefone, e-mail) — o que é **pseudonimização, não anonimização**. A LGPD é explícita: dado pseudonimizado continua sendo dado pessoal. E o conteúdo clínico em si (lesão, medicação, condição cardíaca declarada no PAR-Q) atravessa intacto — é justamente o que o modelo precisa ler para funcionar.

**Impacto:**
- **Sanção administrativa da ANPD**: até 2% do faturamento, limitado a R$50 milhões por infração, além de publicização da infração — que para uma marca de saúde que se vende como "Ciência que treina com você" é o dano maior.
- **Transferência internacional sem base legal** (Art. 33) para jurisdição sem decisão de adequação da ANPD.
- **Contradição direta com um ADR vigente** — o gate executável que o ADR-005-R2 descreve como garantia existe, mas está desarmado. Qualquer auditoria externa (SOC 2, due diligence de investidor, requisição da ANPD) que compare o ADR com o `.env` encontra isso em minutos.
- **Risco contratual com o Responsável Técnico CREF**, cujo registro profissional responde pelos protocolos.

**Probabilidade de exploração:** Não é "exploração" por atacante — é **exposição já em curso**. A probabilidade de o dado já ter saído é ~100%.

**Correção completa:**

**(a) Imediato — desarmar até haver evidência.** Voltar as seis flags para `false` em `apps/api/.env`. O sistema continua funcional para conteúdo `NON_HEALTH`; o que falhar revela exatamente quais caminhos tratam dado de saúde (informação valiosa por si só).

**(b) Classificar antes de reabrir.** Mapear cada `LLMRequest` do código e declarar `dataClass` explicitamente. Hoje o default `?? 'HEALTH'` é o correto como fail-safe, mas significa que caminhos genuinamente não-sensíveis também estão bloqueados. Separar de verdade:
- `PROTOCOL_GENERATION`, `CHECKIN_ADJUSTMENT`, `AI_RESPONSE` sobre conversa do aluno → `HEALTH`;
- geração de copy, classificação de intenção sobre texto já neutralizado → `NON_HEALTH`.

**(c) Reabrir provedor a provedor, com evidência versionada.** Antes de ligar qualquer flag, exigir e arquivar em `docs/juridico/dpa/<provedor>/`:
1. DPA / Data Processing Addendum assinado;
2. Base de transferência internacional (cláusulas-padrão contratuais da ANPD, ou decisão de adequação);
3. Atestado de **zero data retention** e **no-training** por escrito (OpenAI e Anthropic oferecem via ZDR/enterprise; para a DeepSeek, verificar se existe equivalente contratual — se não existir, a flag não sobe);
4. Lista de suboperadores e política de notificação de mudança;
5. Relatório de segurança (SOC 2 Type II / ISO 27001) vigente.

**(d) Tornar o atestado auditável em código.** Substituir o booleano cego por um atestado que carrega a evidência, de modo que ligar a flag sem preencher a proveniência seja impossível:

```ts
// env.schema.ts — o atestado exige a referência documental, não só "true"
LLM_DEEPSEEK_HEALTH_DATA_APPROVED: envBoolean.default(false),
LLM_DEEPSEEK_DPA_REF: z.string().min(1).optional(),  // ex.: 'dpa/deepseek/2026-10-01.pdf#sha256=...'
// ...no superRefine:
if (config.LLM_DEEPSEEK_HEALTH_DATA_APPROVED && !config.LLM_DEEPSEEK_DPA_REF) {
  ctx.addIssue({
    code: 'custom',
    path: ['LLM_DEEPSEEK_HEALTH_DATA_APPROVED'],
    message: 'Atestado HEALTH exige LLM_DEEPSEEK_DPA_REF apontando para o DPA arquivado (ADR-005-R2).',
  });
}
```

**(e) Registrar em `ai_jobs`** (já existe a coluna `dataClass`) um alerta sempre que um job `HEALTH` for para um provedor cujo atestado tenha menos de X dias de validade restante, para que a expiração de DPA seja detectada antes de virar incidente.

**(f) DPIA / RIPD.** Formalizar o Relatório de Impacto à Proteção de Dados Pessoais com Alexandre (CLO) antes do go-live — é praticamente obrigatório dado o tratamento de dado sensível em larga escala com decisão automatizada.

---

## 4. 🟠 ALTO

### A-01 — Desserialização de evento de pagamento sem validação de schema no boundary

**Vulnerabilidade:** OWASP A08:2021 (Software and Data Integrity Failures) / CWE-502 (Deserialization of Untrusted Data). Confiança em dado externo num boundary de confiança.

**Local:** `apps/api/src/modules/subscription/payment/mock-gateway.ts:86`

```ts
return JSON.parse(rawBody.toString('utf8')) as GatewayEvent;
```

**Como é explorável / que brecha abre:**

O `as GatewayEvent` é um *type assertion* do TypeScript — **apagado em tempo de compilação, zero verificação em runtime**. O que chega em `applyGatewayEvent` é literalmente o que o remetente escreveu no corpo.

Isoladamente isso exige a assinatura HMAC válida (portanto encadeia com **C-01**). Mas é um achado independente e mais duradouro por dois motivos:

1. **O padrão será copiado.** `real-gateways.ts:47-53` tem `parseWebhookEvent` como stub a ser implementado no lançamento. Quem implementar vai espelhar o mock. Se o Stripe real herdar `JSON.parse(...) as GatewayEvent`, qualquer falha futura na verificação de assinatura (segredo rotacionado errado, bug de preimage, confusão de endpoint de teste/produção) vira controle total do domínio de assinaturas.
2. **Defesa em profundidade.** A assinatura prova *origem*, não *forma*. Um payload legítimo do Stripe com um campo inesperado (`amountCents: -999999`, `userId` de outro tenant por bug do provedor, `type` desconhecido) atravessa sem resistência. Campos numéricos negativos entram direto na contabilidade.

**Impacto:** Escalada de qualquer falha de assinatura para comprometimento total do domínio financeiro; corrupção silenciosa do livro-razão; `userId` arbitrário atravessando a fronteira de tenant.

**Correção completa:**

Criar o schema em `packages/shared/src/schemas/` e validar em **todos** os gateways, tornando a validação parte do contrato `PaymentGateway`, não escolha de cada adaptador:

```ts
// packages/shared/src/schemas/payment-event.schema.ts
import { z } from 'zod';

export const gatewayEventSchema = z.object({
  type: z.enum([
    'CHECKOUT_CONFIRMED',
    'PAYMENT_FAILED',
    'SUBSCRIPTION_CANCELED',
    'SUBSCRIPTION_RENEWED',
  ]),
  eventId: z.string().min(1).max(200),
  externalSubscriptionId: z.string().min(1).max(200),
  userId: z.uuid(),
  plan: z.enum(['MONTHLY', 'QUARTERLY', 'ANNUAL']).optional(),
  priceCents: z.number().int().nonnegative().max(1_000_000).optional(),
  amountCents: z.number().int().nonnegative().max(1_000_000).optional(),
  feeCents: z.number().int().nonnegative().max(1_000_000).optional(),
  occurredAt: z.iso.datetime().optional(),
}).strict();   // .strict() rejeita campo desconhecido — barra mass assignment futuro

export type GatewayEvent = z.infer<typeof gatewayEventSchema>;
```

```ts
// mock-gateway.ts — e idêntico em StripeGateway/AsaasGateway
try {
  const parsed = gatewayEventSchema.safeParse(JSON.parse(rawBody.toString('utf8')));
  if (!parsed.success) return null;   // null ⇒ 401 uniforme, não vaza o motivo
  return parsed.data;
} catch {
  return null;
}
```

Adicionar teste estrutural (no mesmo espírito do `gateway-confinement.spec.ts` que já existe) garantindo que nenhum `parseWebhookEvent` do repositório retorne sem passar por `gatewayEventSchema`.

---

### A-02 — CSP ausente nas páginas que coletam e exibem dado de saúde

**Vulnerabilidade:** OWASP A05:2021 (Security Misconfiguration). Ausência de Content-Security-Policy na superfície mais sensível do produto.

**Local:** `apps/web/src/proxy.ts:54-58`

```ts
export const config = {
  matcher: ['/entrar', '/dashboard/:path*', '/treino/:path*', '/api/workout/:path*'],
};
```

**Como é explorável / que brecha abre:**

A CSP construída em `proxy.ts:28-43` é de alta qualidade — nonce por request, `strict-dynamic`, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`. É uma política que eu assinaria embaixo.

Mas o `matcher` só a aplica a quatro caminhos. **Ficam sem nenhuma CSP** justamente as rotas que manipulam o dado mais sensível do produto:

| Rota descoberta | Dado que trafega |
|---|---|
| `/anamnese`, `/anamnese/[token]` | **Anamnese completa + PAR-Q integral + dor clínica** — LGPD Art. 11 |
| `/checkin-semanal/[token]` | Evolução clínica, fadiga, sinais de segurança |
| `/protocolo/[token]` | Protocolo de treino individualizado + PDF |
| `/assinar/[token]` | **Fluxo de pagamento** |
| `/conta/[token]` | Dados cadastrais + gestão de assinatura |
| `/mesociclo/[token]` | Histórico de performance |
| `/api/dashboard/:path*` | Todo o BFF do Control Center |

O formulário de anamnese (`onboarding-wizard.tsx`, `step3-parq.tsx`) é o ponto onde o titular digita condição cardíaca, medicação em uso e lesões. É literalmente o dado mais sensível que a MOVIVO toca — e é a página com **menos** proteção de browser do app inteiro.

**Cenário de ataque concreto:** um XSS (via dependência comprometida — ver **M-07** —, via um `dangerouslySetInnerHTML` futuro, ou via um componente de terceiro) em `/anamnese` não encontra nenhuma barreira: sem `connect-src`, o script exfiltra o formulário inteiro para um domínio do atacante enquanto o usuário digita, **antes mesmo de o dado chegar ao backend cifrado**. Sem `form-action 'self'`, o atacante reescreve o destino do submit. Sem `frame-ancestors`, a página pode ser emoldurada para clickjacking sobre o consentimento LGPD — fazendo o titular "aceitar" o tratamento de dado de saúde sem saber.

Toda a criptografia em repouso (pgcrypto), toda a RLS, todo o PII scrubber — são contornados capturando o dado no navegador, antes de entrarem em cena.

> Nota: `next.config.ts:64-80` aplica globalmente `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` e `Permissions-Policy` a `/:path*`. Isso mitiga o clickjacking. Mas `X-Frame-Options` não substitui `frame-ancestors`, e **nada** ali substitui `script-src`/`connect-src`.

**Impacto:** Exfiltração de dado de saúde direto do navegador; contorno de toda a criptografia em repouso; manipulação do fluxo de consentimento; comprometimento do fluxo de pagamento.

**Correção completa:**

Estender o matcher para cobrir toda superfície autenticada ou sensível, e manter fora apenas a landing estática:

```ts
// apps/web/src/proxy.ts
export const config = {
  matcher: [
    '/entrar',
    '/dashboard/:path*',
    '/treino/:path*',
    '/anamnese/:path*',
    '/anamnese',
    '/checkin-semanal/:path*',
    '/protocolo/:path*',
    '/assinar/:path*',
    '/conta/:path*',
    '/mesociclo/:path*',
    '/renovacao/:path*',
    '/semana/:path*',
    '/check-in/:path*',
    '/api/:path*',
  ],
};
```

Preferível ainda: **inverter para allowlist negativa** — aplicar a CSP a tudo e excluir só os assets estáticos, de modo que uma rota nova nasça protegida em vez de nascer descoberta:

```ts
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|webp|woff2)$).*)'],
};
```

Se a landing estática não tolerar a política com nonce, adicionar uma CSP mais frouxa específica para `/` em `next.config.ts` — **mas nunca deixar uma rota de dado de saúde sem política**.

Validar após a mudança com `curl -sI https://<host>/anamnese | grep -i content-security-policy` e com [CSP Evaluator](https://csp-evaluator.withgoogle.com/).

---

### A-03 — Conteúdo de conversa do WhatsApp armazenado em claro (LGPD Art. 11)

**Vulnerabilidade:** OWASP A02:2021 (Cryptographic Failures) / CWE-311 (Missing Encryption of Sensitive Data).

**Local:** `apps/api/src/core/database/schema/conversations.ts:47` — `content: text('content').notNull()`

**Como é explorável / que brecha abre:**

O próprio comentário no código (linhas 42-45) reconhece o problema com honestidade: *"clínica em texto livre — não há como classificar previamente o que é ou não... não cifrada nesta sprint."*

A arquitetura de cifra da MOVIVO é, no resto, excelente e coerente: `anamnesis_sessions.data_block_2` (PAR-Q + dor + todo texto livre), `checkins.notes_cipher`, `protocol_renewal_sessions.data_block_3`, `protocols.mesocycle_notes_cipher` — todos `bytea` via `pgp_sym_encrypt`. A decisão de "cifrar tudo que é livre em vez de auditar o que o usuário digitou" (recomendação de Alexandre §5.7) é exatamente a decisão certa.

`conversations.content` é a exceção — e é a maior superfície de texto livre do produto. O produto **é** uma conversa de WhatsApp. É ali que o aluno escreve "não consegui treinar, a dor no joelho voltou", "meu cardiologista mandou parar", "estou tomando losartana". Volume muito maior que o da anamnese, e igualmente sensível.

A proteção atual é RLS + controle de acesso ao banco. Isso protege contra acesso pela aplicação, mas **não** contra: dump/backup do banco (backups raramente têm a mesma cifra), acesso direto de um operador com credencial de leitura, comprometimento de um snapshot de disco, ou o `movivo_migrator` num incidente. É precisamente o cenário que a cifra em repouso existe para cobrir — e que já está coberto para a anamnese.

**Impacto:** Vazamento de histórico clínico conversacional completo de todos os titulares num único dump; agravante material em caso de incidente (LGPD Art. 48 exige notificação à ANPD e aos titulares); assimetria de proteção difícil de justificar numa auditoria — "por que o PAR-Q está cifrado e a conversa sobre o mesmo PAR-Q não?".

**Correção completa:**

Aplicar o mesmo padrão já validado no projeto. Adicionar coluna cifrada, migrar, e remover a coluna em claro:

```ts
// apps/api/src/core/database/schema/conversations.ts
import { bytea } from './_shared';

/**
 * LGPD Art. 11 — conteúdo de conversa pode conter relato clínico em texto livre.
 * Cifrado em repouso com pgcrypto (HealthCipherService), mesmo tratamento de
 * anamnesis_sessions.data_block_2.
 */
contentCipher: bytea('content_cipher').notNull(),
```

No `ConversationRepository`, encapsular a cifra de modo que nenhum caller possa esquecê-la:

```ts
async append(userId: string, turn: ConversationTurn): Promise<void> {
  const contentCipher = await this.cipher.encryptHealth(turn.content);
  await this.db.runAsUser(userId, 'USER', (tx) =>
    tx.insert(conversations).values({ ...turn, userId, contentCipher }),
  );
}
```

Migração: adicionar `content_cipher` nullable → job de backfill que cifra linha a linha sob `runAsSystem` → tornar `NOT NULL` → `DROP COLUMN content`. Importante: `VACUUM FULL` na tabela após o drop, porque o Postgres mantém as tuplas antigas em páginas mortas até então.

**Custo a considerar:** a janela de contexto do AI Coach é a query mais frequente do produto (comentário em `conversations.ts:95`). Cifrar significa decifrar N turnos a cada mensagem recebida. Mitigação: manter a janela quente decifrada no `WorkingMemory` (Redis, com TTL curto e `REDIS_TLS_ENABLED=true` em produção), pagando a decifra só no *cache miss*. Medir antes de assumir que é caro — `pgp_sym_decrypt` de alguns KB é da ordem de microssegundos.

---

### A-04 — HSTS ausente em toda a aplicação

**Vulnerabilidade:** OWASP A02:2021 (Cryptographic Failures) / CWE-319 (Cleartext Transmission).

**Local:**
- `apps/web/next.config.ts:64-80` — bloco `headers()` sem `Strict-Transport-Security`
- `apps/web/src/proxy.ts:28-43` — CSP tem `upgrade-insecure-requests`, mas isso não é HSTS
- `apps/api/src/main.ts` — nenhum header de segurança na API (ver **M-01**)

**Como é explorável / que brecha abre:**

`upgrade-insecure-requests` (presente na CSP) reescreve sub-recursos `http:` para `https:` **depois** que a página já carregou por HTTPS. Não protege a **primeira** requisição de navegação — que é exatamente onde o ataque acontece.

Cenário realista para o ICP da MOVIVO (18-30 anos, mobile-first, clicando em link de WhatsApp em Wi-Fi público de academia): o usuário toca em `movivo.com.br/anamnese`. Sem HSTS, o navegador tenta `http://` primeiro. Um atacante na mesma rede (`sslstrip`/`bettercap`) intercepta, mantém a sessão em texto claro e captura:

- o **token do magic-link** na URL (`/protocolo/<token>`, `/checkin-semanal/<token>`, `/conta/<token>`) — esses tokens valem 48h a 30 dias e dão acesso completo ao dado de saúde do titular;
- o formulário de anamnese em trânsito;
- os cookies de sessão do dashboard (mitigado por `secure: true` em produção, mas o token de URL não tem essa proteção).

Sem HSTS não há `preload`, e sem `includeSubDomains` um subdomínio esquecido (`api.`, `staging.`) vira o ponto de entrada.

**Impacto:** Captura de magic-link tokens em rede hostil → acesso completo a dado de saúde de um titular; downgrade de toda a proteção de transporte; impossibilidade de entrar na lista de preload dos navegadores.

**Correção completa:**

Adicionar em `apps/web/next.config.ts`, no array de headers existente:

```ts
{
  key: 'Strict-Transport-Security',
  value: 'max-age=63072000; includeSubDomains; preload',
},
```

Cuidados de implantação, nesta ordem:
1. Confirmar que **todos** os subdomínios (incluindo `api.`, `staging.`, qualquer painel interno) servem HTTPS válido antes de ligar `includeSubDomains` — HSTS é irreversível pelo tempo do `max-age`;
2. Subir gradualmente: `max-age=300` → `86400` → `63072000`;
3. Só depois de estável, submeter a https://hstspreload.org/.

Se houver Cloudflare/nginx na frente, ativar HSTS **também** lá (defesa em profundidade — a aplicação pode ser reiniciada com config errada; a borda não). Se o header já estiver sendo servido pela borda, este achado cai para INFORMATIVO — mas **não pude verificar isso** (ver Limitações §2).

Para a API, ver **M-01**.

---

### A-05 — Direito à eliminação (LGPD Art. 18, VI) não implementado

**Vulnerabilidade:** Não conformidade regulatória — direito do titular indisponível.

**Local:** `apps/api/src/modules/admin/control-center.controller.ts:211-235`

```ts
@Post('admin/subjects/:id/anonymize')
denyUnsafeAnonymization(@Param('id', ...) _id: string): never {
  throw new ConflictException({ code: 'STEP_UP_REQUIRED_NOT_IMPLEMENTED', ... });
}
```

**Como é explorável / que brecha abre:**

Não é uma vulnerabilidade explorável por atacante — é uma **exposição regulatória** com prazo legal correndo.

A decisão de engenharia é defensável: bloquear a anonimização até existir step-up de autenticação e workflow de retenção auditável evita que uma conta de dashboard comprometida destrua dados de titulares de forma irreversível. **Concordo com o raciocínio defensivo.** Um endpoint destrutivo mal protegido seria pior.

O problema é que a LGPD não aceita "ainda não implementamos" como resposta. Art. 18, VI garante ao titular a eliminação dos dados tratados com base no consentimento; Art. 18 §3º fixa prazo de resposta (15 dias, conforme regulamentação da ANPD). Uma única solicitação de titular — ou uma reclamação na ANPD — coloca a MOVIVO em descumprimento demonstrável, com o próprio código servindo de prova documental de que o direito era tecnicamente indisponível.

Agravante: o produto trata dado de saúde e será operado por um profissional CREF cujo registro responde profissionalmente.

Atenuante real: a MOVIVO tem **zero usuários captados** hoje (registrado na memória do projeto, 2026-09-11). O risco atual é ~0 e a janela para corrigir antes do go-live está aberta. **Este é um bloqueador de lançamento, não um incidente em curso.**

**Impacto:** Descumprimento de direito do titular; sanção da ANPD; incapacidade de responder a requisição de titular dentro do prazo legal; achado bloqueante em qualquer due diligence.

**Correção completa:**

**(a) Curto prazo (antes do primeiro usuário real — obrigatório):** processo manual documentado e auditável. Criar `docs/juridico/runbook-direitos-do-titular.md` com: canal de recebimento (e-mail do DPO), prazo, identificação do solicitante, procedimento SQL executado sob quatro olhos, e registro em `audit_logs`. Um processo manual documentado **atende** a LGPD; a ausência de processo, não.

**(b) Implementar a anonimização de verdade.** A coluna `users.anonymized_at` já existe (`users.ts:118`) e a estratégia (anonimizar em vez de deletar, preservando integridade referencial e obrigações de retenção fiscal) está correta. Falta a execução:

```ts
async anonymizeSubject(actorId: string, targetUserId: string, justification: string) {
  return this.db.runAsSystem(async (tx) => {
    // 1. Dado direto de identificação → placeholder determinístico
    await tx.update(users).set({
      name: 'TITULAR ANONIMIZADO',
      email: `anon+${targetUserId}@invalido.movivo`,
      phoneE164: null,
      passwordHash: null,
      birthDate: null,
      anonymizedAt: new Date(),
    }).where(eq(users.id, targetUserId));

    // 2. Blocos cifrados de saúde → NULL (a cifra some junto com o dado)
    await tx.update(anamnesisSessions)
      .set({ dataBlock1: null, dataBlock2: null, dataBlock3: null, phoneE164: null })
      .where(eq(anamnesisSessions.userId, targetUserId));
    await tx.update(conversations)
      .set({ contentCipher: null })   // ver A-03
      .where(eq(conversations.userId, targetUserId));
    await tx.update(checkins)
      .set({ notesCipher: null })
      .where(eq(checkins.userId, targetUserId));

    // 3. Revogar sessões e tokens ativos
    await tx.update(authSessions).set({ revokedAt: new Date() })
      .where(eq(authSessions.userId, targetUserId));
    await tx.update(workoutAccessTokens).set({ revokedAt: new Date() })
      .where(eq(workoutAccessTokens.userId, targetUserId));

    // 4. `payments` NÃO é tocada — retenção fiscal obrigatória (5 anos) é
    //    base legal autônoma (LGPD Art. 16, I). Documentar isso ao titular.

    // 5. Trilha imutável
    await this.audit.record(tx, {
      actorId, action: 'SUBJECT_ANONYMIZED',
      targetUserId, justification,
    });
  });
}
```

**(c) Step-up de autenticação**, que é o bloqueio legítimo hoje: exigir reautenticação com senha + TOTP (ou passkey) emitindo um token de escopo único e TTL de 5 minutos, válido só para esta operação. Manter a capability `ADMIN_DESTRUCTIVE_REQUEST` já definida.

**(d) Portabilidade (Art. 18, V)** — mesma lacuna, mesma urgência. Endpoint que exporta os dados do titular em JSON estruturado, autenticado pelo próprio titular via magic-link (não pelo dashboard).

---

## 5. 🟡 MÉDIO

### M-01 — API sem nenhum header de segurança (helmet ausente)

**Vulnerabilidade:** OWASP A05:2021 (Security Misconfiguration).

**Local:** `apps/api/src/main.ts:37-116` — bootstrap completo, sem `helmet`. Confirmado: `helmet` não consta em `apps/api/package.json` nem em nenhum arquivo do repositório.

**Como é explorável:** A API serve `/account/avatar/:filename` (bytes binários, sem autenticação), `/protocol/:token/pdf` e respostas JSON com dado de saúde. Sem `X-Content-Type-Options: nosniff`, sem `X-Frame-Options`, sem `Referrer-Policy` global, sem `Cross-Origin-Resource-Policy`. O `apps/web` tem todos esses headers (`next.config.ts:64-80`); a API não tem nenhum — assimetria que provavelmente é descuido, não decisão.

`app.disable('x-powered-by')` (`main.ts:101`) está correto, mas é o único controle presente.

Encadeia com **M-04**: um arquivo de avatar com bytes de HTML servido sem `nosniff` é a receita de XSS por *content sniffing*.

**Impacto:** Content sniffing; vazamento de URL com token via `Referer`; enquadramento de respostas da API; leitura cross-origin de recursos sem CORP.

**Correção completa:**

```bash
pnpm --filter @movivo/api add helmet
```

```ts
// apps/api/src/main.ts — após o cookieParser, antes do listen
import helmet from 'helmet';

app.use(
  helmet({
    // A API é JSON + binário, nunca HTML navegável: uma CSP restritiva é barata e correta.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
        sandbox: ['allow-downloads'],
      },
    },
    // Recursos da API (avatar, PDF) são consumidos pelo apps/web em outra origem.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    // Token em path (/protocol/:token/pdf) nunca pode vazar pelo Referer.
    referrerPolicy: { policy: 'no-referrer' },
    hsts: {
      maxAge: 63072000,
      includeSubDomains: true,
      preload: true,
    },
    // `nosniff`, `X-Frame-Options: DENY` e `X-DNS-Prefetch-Control` vêm nos defaults.
  }),
);
```

Nota: `crossOriginResourcePolicy: 'cross-origin'` é necessário porque `apps/web` consome a API de outra origem; usar `same-origin` quebraria o proxy de avatar. Validar com `curl -sI` após a mudança.

---

### M-02 — Rate limiting em memória por processo, sem storage distribuído

**Vulnerabilidade:** OWASP A04:2021 (Insecure Design) / CWE-770 (Allocation Without Limits or Throttling).

**Local:**
- `apps/api/src/modules/subscription/subscription.module.ts:32` — `ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 60 }] })` sem `storage`
- `apps/api/src/modules/anamnesis/anamnesis.module.ts:24`, `apps/api/src/modules/protocol-renewal/protocol-renewal.module.ts:18` — idem
- Comentário honesto no próprio código: `subscription.module.ts:31` — *"ponytail: storage em memória (MVP single-instance)"*

**Como é explorável:**

O storage padrão do `@nestjs/throttler` é um `Map` em memória do processo. Consequências:

1. **Multi-instância anula o limite.** Com N réplicas (ou N processos PM2/cluster), o limite efetivo vira `N × limit`. A memória do projeto já registra o problema de *"processos da API duplicados"* rodando na máquina do fundador — ou seja, o cenário não é hipotético.
2. **Restart zera o contador.** Um atacante que force crash/restart (ou simplesmente aguarde um deploy) recomeça do zero.
3. **Rotas protegidas são as mais sensíveis**: login (10/min — `auth.controller.ts:59`), webhook de pagamento (30/min), anamnese (60/min), geração de protocolo.

Há ainda uma fragilidade de configuração: `ThrottlerModule.forRoot` é **global e last-wins**. Três módulos distintos chamam `forRoot` com o mesmo valor (60/min), e `AuthModule` deliberadamente não chama, contando com o global — como documentado em `auth.module.ts:8-12`. Funciona hoje porque os três valores são idênticos; se alguém alterar um deles, o comportamento muda em rotas não relacionadas, de forma difícil de rastrear.

**Impacto:** Brute force de login viável; força bruta de assinatura no webhook de pagamento; abuso de custo de IA; abuso do canal WhatsApp (custo por mensagem e risco de ban do número).

**Correção completa:**

**(a)** Usar o Redis que já existe no CORE:

```bash
pnpm --filter @movivo/api add @nest-lab/throttler-storage-redis
```

**(b)** Centralizar num único `forRoot` no `CoreModule` (elimina o last-wins):

```ts
// apps/api/src/core/core.module.ts
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { REDIS_CLIENT } from './redis/redis.constants';

ThrottlerModule.forRootAsync({
  inject: [REDIS_CLIENT],
  useFactory: (redis: Redis) => ({
    throttlers: [{ name: 'default', ttl: 60_000, limit: 60 }],
    storage: new ThrottlerStorageRedisService(redis),
  }),
}),
```

**(c)** Remover os três `ThrottlerModule.forRoot` de `subscription.module.ts:32`, `anamnesis.module.ts:24` e `protocol-renewal.module.ts:18`. Os `@Throttle()` por rota continuam funcionando como override.

**(d)** Cuidado com o `trust proxy` — ver **B-04**.

---

### M-03 — Ausência de bloqueio de conta após falhas de autenticação repetidas

**Vulnerabilidade:** OWASP A07:2021 (Identification and Authentication Failures) / CWE-307 (Improper Restriction of Excessive Authentication Attempts).

**Local:** `apps/api/src/modules/auth/auth.service.ts` (nenhum mecanismo de lockout — confirmado por busca) e `apps/api/src/modules/auth/auth.controller.ts:59-60` (única proteção: `@Throttle({ default: { limit: 10, ttl: 60_000 } })` por IP).

**Como é explorável:**

O throttle é **por IP**, não por conta. Um atacante com pool de IPs residenciais (serviço comercial, ~US$1/GB) ou uma botnet contorna trivialmente: 10 tentativas por IP por minuto × 1.000 IPs = 10.000 tentativas/min contra a mesma conta, sem jamais disparar o limite.

O alvo é pequeno e valioso: as contas do Control Center pertencem aos fundadores e ao profissional CREF. Uma delas comprometida dá acesso a **todos** os dados de saúde de **todos** os titulares (fila de supervisão, anamnese de alunos, painel de compliance). Não há MFA (ver **I-03**).

O que já está certo e reduz o risco: Argon2id com custo padrão OWASP torna cada tentativa cara (~50-100ms de CPU do servidor), e o dummy hash (`password.service.ts:17-18`) elimina o oráculo de enumeração de usuários. Mas custo por tentativa não é o mesmo que limite de tentativas.

**Impacto:** Credential stuffing e brute force contra contas administrativas com acesso a dado de saúde de toda a base.

**Correção completa:**

Bloqueio exponencial **por conta** (não por IP), no Redis, aplicado antes do `argon2.verify`:

```ts
// apps/api/src/modules/auth/login-attempt.service.ts
const MAX_ATTEMPTS = 5;
const BASE_LOCK_SECONDS = 60;

@Injectable()
export class LoginAttemptService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
  ) {}

  /** Chave pelo HASH do e-mail: o e-mail é PII e não entra no keyspace do Redis. */
  private key(email: string): string {
    return this.keys.global('login-fail', createHash('sha256').update(email.toLowerCase()).digest('hex'));
  }

  async assertNotLocked(email: string): Promise<void> {
    const fails = Number((await this.redis.get(this.key(email))) ?? 0);
    if (fails >= MAX_ATTEMPTS) {
      // Backoff exponencial com teto de 15 min: 1min, 2min, 4min, 8min, 15min.
      const lock = Math.min(BASE_LOCK_SECONDS * 2 ** (fails - MAX_ATTEMPTS), 900);
      throw new UnauthorizedException('E-mail ou senha incorretos.'); // mensagem IDÊNTICA
    }
  }

  async recordFailure(email: string): Promise<void> {
    const k = this.key(email);
    const fails = await this.redis.incr(k);
    await this.redis.expire(k, Math.min(BASE_LOCK_SECONDS * 2 ** Math.max(0, fails - MAX_ATTEMPTS), 900));
  }

  async recordSuccess(email: string): Promise<void> {
    await this.redis.del(this.key(email));
  }
}
```

Pontos não negociáveis desta implementação:
- **A mensagem de erro do bloqueio deve ser idêntica à de senha errada.** Dizer "conta bloqueada" recria o oráculo de enumeração que o dummy hash eliminou.
- **Chavear pelo hash do e-mail**, nunca pelo e-mail em claro — o Redis é sistema de terceiros na prática (mesma regra de `redaction.util.ts`).
- Emitir evento de auditoria em `audit_logs` no bloqueio, e alertar o fundador por WhatsApp quando uma conta administrativa for bloqueada (sinal de ataque direcionado).

---

### M-04 — Upload de avatar confia no MIME informado pelo cliente, sem validação de magic bytes

**Vulnerabilidade:** OWASP A04:2021 (Insecure Design) / CWE-434 (Unrestricted Upload of File with Dangerous Type).

**Local:**
- `apps/api/src/modules/account/account.controller.ts:158-160` — valida `file.mimetype`
- `apps/api/src/modules/account/avatar-storage.service.ts:68-79` — escolhe a extensão a partir do mesmo `file.mimetype`

**Como é explorável:**

Primeiro, o crédito devido: **a defesa contra path traversal aqui é exemplar**. O nome do arquivo é um `randomUUID()` gerado no servidor (nunca o nome do cliente), e a leitura valida contra `AVATAR_FILENAME_RE` (`avatar-storage.service.ts:44-45`) tanto no backend quanto no proxy do Next (`route.ts:18-19`). Não há path traversal. Testei o raciocínio nos dois lados.

O problema é outro: `file.mimetype` vem do multer, que o extrai do header `Content-Type` **da parte multipart** — ou seja, é declarado pelo cliente e trivialmente forjável. O conteúdo real nunca é inspecionado.

Um usuário autenticado do dashboard pode enviar qualquer conteúdo (HTML com `<script>`, SVG com `onload`, polígото PNG/HTML) declarando `Content-Type: image/png`. O arquivo é gravado como `<uuid>.png` e servido em `/api/dashboard/account/avatar/<uuid>.png` — **same-origin com o dashboard**.

A resposta força `Content-Type: image/png` (`account.controller.ts:196`), o que mitiga bastante em navegadores modernos. Mas **não há `X-Content-Type-Options: nosniff`** nem na API (ver **M-01**) nem no proxy do Next (`route.ts:35-42`, que copia só `Content-Type` e `Cache-Control` do upstream). Sem `nosniff`, o comportamento depende da heurística do navegador — uma dependência que não se deve aceitar num app de saúde.

Atenuantes reais que rebaixam isto de ALTO para MÉDIO: requer conta autenticada do Control Center (5 pessoas de confiança hoje), e o `Content-Type` é definido pelo servidor. Mas o vetor é de **insider/conta comprometida para persistência de XSS no dashboard**, e o dashboard é o ponto de acesso a todos os dados de saúde.

**Impacto:** XSS armazenado *same-origin* no Control Center via content sniffing; consumo de disco com conteúdo arbitrário; hospedagem inadvertida de conteúdo malicioso sob o domínio da MOVIVO.

**Correção completa:**

**(a) Validar magic bytes** — nunca confiar no MIME declarado:

```ts
// avatar-storage.service.ts
const MAGIC: ReadonlyArray<{ mime: string; ext: string; test: (b: Buffer) => boolean }> = [
  { mime: 'image/jpeg', ext: 'jpg',  test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png',  ext: 'png',  test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.length > 12 && b.subarray(0,4).toString('ascii') === 'RIFF' && b.subarray(8,12).toString('ascii') === 'WEBP' },
];

/** Detecta o tipo REAL pelos bytes. `null` ⇒ não é imagem suportada, rejeita. */
export function sniffImageType(buffer: Buffer): { mime: string; ext: string } | null {
  return MAGIC.find((m) => m.test(buffer)) ?? null;
}
```

No `save()`, usar **exclusivamente** o resultado de `sniffImageType(file.buffer)` para escolher extensão e `Content-Type`; descartar `file.mimetype` por completo.

**(b) Re-encodar a imagem** — a defesa mais forte, porque destrói qualquer polígoto ou payload em metadados EXIF:

```bash
pnpm --filter @movivo/api add sharp
```
```ts
const normalized = await sharp(file.buffer)
  .rotate()                                  // aplica orientação EXIF
  .resize(512, 512, { fit: 'cover' })
  .webp({ quality: 82 })
  .toBuffer();                               // metadados descartados por padrão
```
Atenção: `sharp` depende de `libvips`; acompanhar advisories (o release de agosto/2026 do Next.js citou RCE via `libheif` em `sharp`). Desabilitar formatos que não sejam JPEG/PNG/WebP na entrada.

**(c) Adicionar `nosniff` explicitamente** nos dois lados:

```ts
// account.controller.ts, em serveAvatar
res.setHeader('X-Content-Type-Options', 'nosniff');
res.setHeader('Content-Disposition', 'inline');
```
```ts
// apps/web/src/app/api/dashboard/account/avatar/[filename]/route.ts
headers: {
  'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': upstream.headers.get('cache-control') ?? 'public, max-age=31536000, immutable',
},
```

---

### M-05 — Preimage do HMAC do webhook AraraHQ nunca validado contra entrega real (bloqueador de produção)

**Vulnerabilidade:** OWASP A04:2021 (Insecure Design). Controle de autenticação não verificado.

**Local:** `apps/api/src/modules/whatsapp/webhook-signature.ts:4-19, 54-57`

**Como é explorável:**

Este achado é reportado **como o próprio código o documenta** — e a documentação é modelar. O comentário de cabeçalho declara abertamente: *"PREIMAGE AINDA NÃO CONFIRMADO... A doc consultada diz 'HMAC-SHA256 sobre o corpo bruto apenas, sem timestamp no preimage' — DIFERENTE do que este arquivo assume."*

A análise de risco embutida no código está **correta**: o erro é fail-closed nas duas direções (assinatura nunca bate → sempre rejeita, nunca aceita forjada). Não há vulnerabilidade de segurança direta.

O risco real é **operacional, e se manifesta no pior momento possível**: na migração do transporte para a AraraHQ em produção, 100% das mensagens recebidas serão silenciosamente descartadas (o controller sempre responde 200 — `webhook.controller.ts:74`). O sintoma será "o AI Coach parou de responder", sem erro visível ao usuário nem status HTTP de falha, e a causa (`reason: 'bad_signature'` no log interno) fica a várias camadas de distância do sintoma.

Além disso, o mesmo comentário registra um segundo item em aberto: o nonce anti-replay provavelmente deve vir do header `x-arara-webhook-id`, não do corpo — e `whatsapp-inbound.service.ts` ainda não foi ajustado a esse achado.

**Impacto:** Indisponibilidade total e silenciosa do canal de entrada no go-live; janela de replay se o nonce estiver ancorado no campo errado.

**Correção completa:**

1. **Confirmar contra entrega real** (não contra documentação), seguindo o runbook que o próprio arquivo descreve: configurar o webhook no dashboard AraraHQ, disparar evento de teste, capturar corpo bruto + headers num ambiente isolado com dado sintético (**nunca com dado de titular real, nunca em produção**), e ajustar `buildPreimage()` conforme o preimage real.
2. **Suportar ambos os formatos durante a transição**, com métrica que revele qual está em uso:

```ts
const candidates = [
  Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), rawBody]),  // hipótese atual
  rawBody,                                                          // hipótese da doc
];
for (const [i, preimage] of candidates.entries()) {
  const expected = createHmac('sha256', secret).update(preimage).digest();
  if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
    if (i === 1) logger.warn({ event: 'arara_preimage_is_raw_body' }, 'preimage confirmado: corpo puro');
    return { ok: true };
  }
}
return { ok: false, reason: 'bad_signature' };
```
Após confirmação, **remover o candidato incorreto** — aceitar dois formatos indefinidamente dobra a superfície.
3. **Alerta de saúde do webhook**: se a taxa de `bad_signature` ultrapassar 5% numa janela de 5 minutos, alertar imediatamente. Hoje esse modo de falha é invisível por design (200 uniforme).
4. **Corrigir o nonce anti-replay** para `x-arara-webhook-id`, conforme o achado já registrado.

---

### M-06 — Webhook da EvolutionAPI autenticado só por token estático, sem vínculo ao corpo

**Vulnerabilidade:** OWASP A07:2021 / CWE-345 (Insufficient Verification of Data Authenticity).

**Local:** `apps/api/src/modules/whatsapp/inbound/evolution-inbound.edge.ts:182-188`

**Como é explorável:**

O design aqui é bem fundamentado e as mitigações são reais: comparação em tempo constante (`secret-compare.ts`), fail-closed sem segredo, validação do nome da instância (`evolution-inbound.edge.ts:199-202`), descarte de `fromMe` e de mensagens de grupo, e nonce anti-replay em Redis. A decisão de **não** reusar `EVOLUTION_API_KEY` como token de webhook — porque a EvolutionAPI publica essa chave no corpo de toda entrega — é uma observação fina que muita gente sênior deixaria passar.

A limitação é estrutural do provedor: a EvolutionAPI não assina o corpo. O token é um *bearer* estático, repetido identicamente em toda entrega, sem vínculo criptográfico ao payload e sem janela de tempo.

Consequência: quem obtiver o token **uma vez** (log de proxy reverso, histórico de shell, captura de tráfego se algum hop for HTTP, um `console.log` de debug) pode injetar mensagens arbitrárias atribuídas a **qualquer número de telefone** conhecido pelo sistema. O `resolveSenderPhone` mapeia o telefone para o titular, e a mensagem entra na conversa dele — envenenando o contexto do AI Coach, disparando geração de protocolo, ou induzindo o coach a responder algo fora de escopo em nome da MOVIVO.

Agravante de configuração: `apps/api/.env` tem `WHATSAPP_TRANSPORT_PROVIDER=EVOLUTION`, ou seja, **este é o transporte ativo hoje** — apesar de o código o descrever como "teste interno" e de o default do schema ser `ARARA`.

**Impacto:** Impersonação de titular no canal de entrada; envenenamento de contexto do AI Coach; consumo de orçamento de IA por terceiro; injeção de conteúdo na conversa que depois é exibida ao profissional CREF.

**Correção completa:**

1. **Nunca promover a EvolutionAPI a produção.** Garantir por schema que ela só exista fora de produção:

```ts
// env.schema.ts, no superRefine existente
if (config.APP_ENV === 'production' && config.WHATSAPP_TRANSPORT_PROVIDER === 'EVOLUTION') {
  ctx.addIssue({
    code: 'custom',
    path: ['WHATSAPP_TRANSPORT_PROVIDER'],
    message: 'EvolutionAPI (Baileys) é transporte de teste — proibido em produção. Use ARARA.',
  });
}
```
Isso complementa o guard já existente em `webhook.controller.ts:103`, que desliga a rota quando o transporte não é EVOLUTION.

2. **Restringir por IP na borda.** A EvolutionAPI roda em container conhecido: aplicar allowlist de origem no nginx/Cloudflare para `/api/v1/webhook/whatsapp/evolution`. Defesa que independe do segredo.
3. **Rotacionar `EVOLUTION_WEBHOOK_TOKEN`** periodicamente e após qualquer suspeita — é trivial (`POST /webhook/set/{instance}` reconfigura os headers).
4. **Confirmar que o token não vaza**: o serializer do pino (`logger.module.ts:78-90`) registra apenas `id`/`method`/`path` e **não registra headers** — verifiquei, e está correto. Manter assim; se algum dia headers forem logados, adicionar `x-movivo-webhook-token` e `x-arara-signature` a `REDACT_PATHS`.

---

### M-07 — Dependência de supply chain de alto risco: `js-rich-body-highlighter@0.1.1`

**Vulnerabilidade:** OWASP A06:2021 (Vulnerable and Outdated Components) / A08:2021 (Software and Data Integrity Failures).

**Local:**
- `apps/web/package.json:26` (adicionado no working tree, ainda não commitado)
- `apps/web/src/components/workout/share-card/WorkoutShareCard.tsx:4` — `import { MuscleMap } from 'js-rich-body-highlighter/react';`

**Como é explorável:**

O pacote foi adicionado nas alterações não commitadas. Perfil de risco:

- **Versão 0.1.1** — pré-1.0, sem garantia de estabilidade nem de processo de release;
- **Mantenedor único** (`crmapache`), sem organização, sem processo de revisão conhecido;
- **Adoção essencialmente nula** — não aparece em bases de segurança (Snyk, Socket) nem por vulnerabilidade nem por reputação, o que significa ausência de escrutínio da comunidade;
- **Publica um web component** com `sideEffects: ["**/web-component/**"]`, ou seja, executa código no import;
- É renderizado dentro de `/treino`, que é uma superfície autenticada por `sessionToken` de 30 dias.

Não encontrei indício de que seja malicioso — a pesquisa não retornou alerta algum, e o pacote parece ser exatamente o que anuncia (mapa muscular SVG para fitness). **Declaro isso explicitamente para não inflar o achado.** O risco é de *perfil*, não de comprometimento conhecido: pacotes novos, de mantenedor único e baixa adoção são o vetor preferencial de ataques de supply chain (comprometimento de conta npm do mantenedor, publicação de versão maliciosa), e o histórico recente do ecossistema npm é farto de casos assim.

O agravante específico da MOVIVO: um `postinstall` malicioso numa máquina de dev roda com acesso ao diretório `secrets/` — que contém chaves de API vivas, a chave privada JWT e a chave pgcrypto de dado de saúde (ver **M-08**).

**Impacto:** Execução de código arbitrário em build/CI/máquina de dev numa futura versão comprometida; XSS no app via SVG injetado; exfiltração de `secrets/`.

**Correção completa:**

1. **Fixar versão exata** (já está: `0.1.1`, sem `^`) e **confiar no lockfile** — `pnpm-lock.yaml` já registra o integrity hash. Manter `frozen-lockfile` no CI.
2. **Desabilitar scripts de instalação por padrão** no monorepo:
```yaml
# pnpm-workspace.yaml
neverBuiltDependencies:
  - js-rich-body-highlighter
```
Ou, mais robusto, `enable-pre-post-scripts=false` em `.npmrc` e allowlist explícita via `onlyBuiltDependencies` para os pacotes que genuinamente precisam compilar (`argon2`, `sharp`).
3. **Revisar o código do pacote** antes do go-live — é pequeno; ler `dist/` e confirmar que não há rede, `eval`, nem acesso a `process.env`.
4. **Avaliar vendorizar.** É um SVG de mapa muscular. Copiar o componente para `apps/web/src/components/workout/share-card/muscle-map/` sob licença MIT (com atribuição) elimina a dependência externa permanentemente. Para um app de saúde, essa é provavelmente a decisão certa.
5. **Adicionar Socket.dev ou `pnpm audit --audit-level=moderate`** ao CI para detecção de comportamento anômalo em dependências novas.

---

### M-08 — Arquivos de segredo com permissão 0644 e inconsistente

**Vulnerabilidade:** OWASP A05:2021 / CWE-732 (Incorrect Permission Assignment for Critical Resource).

**Local:** diretório `secrets/` (gerado por `scripts/gen-local-secrets.sh`)

```
drwx------  secrets/                              ← diretório OK (0700)
-rw-r--r--  secrets/jwt_private_key               ← chave privada RS256
-rw-r--r--  secrets/pgcrypto_key                  ← chave de cifra do dado de saúde
-rw-r--r--  secrets/postgres_superuser_password
-rw-r--r--  secrets/deepseek_api_key              ← chave viva
-rw-r--r--  secrets/openai_api_key                ← chave viva
-rw-r--r--  secrets/anthropic_api_key             ← chave viva
-rw-r--r--  secrets/ararahq_api_key               ← chave viva
-rw-r--r--  secrets/pgbouncer_userlist.txt        ← usuário + senha em claro
-rw-------  secrets/dev_professional_password     ← 0600 (correto)
-rw-------  secrets/groq_api_key                  ← 0600 (correto)
```

**Como é explorável:**

O diretório em `0700` é a proteção efetiva — outro usuário local não consegue atravessá-lo, então os `0644` internos não são exploráveis hoje. Por isso MÉDIO e não ALTO.

Mas a configuração é frágil por três razões:
1. **Inconsistência revela ausência de padrão.** Dois arquivos estão em `0600` e dez em `0644`. Isso indica que a permissão correta acontece por acidente, não por política — e o próximo segredo gerado tem chance de nascer errado.
2. **Uma única mudança no diretório expõe tudo.** Um `chmod 755 secrets/` acidental (ou um processo de cópia/backup que não preserve modo) torna dez segredos legíveis por qualquer processo do sistema.
3. **Backup e sincronização não preservam a proteção do diretório.** Time Machine, sincronização de nuvem, ou um `tar` sem `--preserve-permissions` propagam o `0644`.

Estes são segredos vivos: `pgcrypto_key` é a **única** coisa entre um dump do banco e o dado de saúde em claro de todos os titulares; `jwt_private_key` permite forjar access token de qualquer papel, inclusive administrativo.

**Impacto:** Exposição local de chaves vivas; comprometimento da cifra de dado de saúde; forja de identidade administrativa.

**Correção completa:**

**(a)** Corrigir agora:
```bash
chmod 700 /Users/rodrigo/Documents/movivo/secrets
chmod 600 /Users/rodrigo/Documents/movivo/secrets/*
chmod 644 /Users/rodrigo/Documents/movivo/secrets/README.md
```

**(b)** Corrigir na origem, em `scripts/gen-local-secrets.sh`, para que nunca mais nasça errado:
```bash
umask 077                       # tudo criado a partir daqui nasce 0600
mkdir -p "$SECRETS_DIR"
chmod 700 "$SECRETS_DIR"
# ...geração...
chmod 600 "$SECRETS_DIR"/*
chmod 644 "$SECRETS_DIR/README.md"   # o README é público de propósito
```
Espelhar em `scripts/gen-local-secrets.ps1` (ACL do Windows).

**(c)** Adicionar verificação ao `scripts/verify-infra.sh`, para que o desvio seja detectado e não apenas corrigido uma vez:
```bash
find "$SECRETS_DIR" -type f ! -name 'README.md' ! -perm 600 -print | \
  grep -q . && { echo "ERRO: segredo com permissão diferente de 600"; exit 1; }
```

**(d)** **Rotacionar todas as chaves antes do go-live.** As chaves atuais viveram em `0644`, foram usadas em desenvolvimento e possivelmente apareceram em terminais e backups. Tratar como potencialmente comprometidas é mais barato que descobrir que estavam.

**(e)** Em produção, não usar arquivos em disco: usar Docker Secrets reais (`/run/secrets`, `tmpfs`, `0400`, montados por serviço) ou um gerenciador (Infisical, Doppler, Vault). O contrato `*_FILE` já implementado em `resolve-file-secrets.ts` suporta isso sem mudança de código — é só apontar para `/run/secrets/`.

---

### M-09 — Vulnerabilidades conhecidas em dependências transitivas

**Vulnerabilidade:** OWASP A06:2021 (Vulnerable and Outdated Components).

**Local:** `pnpm-lock.yaml`. Resultado real de `pnpm audit` executado nesta auditoria: **3 vulnerabilidades moderadas, 0 altas, 0 críticas.**

| Pacote | Versão | Advisory | Caminho |
|---|---|---|---|
| `qs` | 6.15.3 | [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) — array-limit bypass (corrigido em 6.15.4) | `@nestjs/platform-express > express > qs` (19 caminhos) |
| `qs` | 6.15.3 | [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) — DoS via `isBuffer` controlado (corrigido em 6.16.0) | idem |
| `esbuild` | ≤0.24.2 | [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) — qualquer site pode ler respostas do dev server | `drizzle-kit > @esbuild-kit/* > esbuild` (**devDependency**) |

**Como é explorável:**

- **`qs` (ambos):** afeta o parsing de query string do Express, que serve toda a API. O impacto prático é limitado — DoS por consumo de CPU/memória com query string maliciosa. Mitigado parcialmente pelo `ValidationPipe` global com `whitelist`/`forbidNonWhitelisted` (`main.ts:73-74`) e pelos rate limits, mas o parsing acontece **antes** do pipe.
- **`esbuild`:** só afeta o servidor de desenvolvimento do `drizzle-kit` (`db:studio`, `db:generate`). Se um desenvolvedor rodar `pnpm db:studio` e visitar um site malicioso no mesmo navegador, esse site pode fazer requisições ao dev server local e ler as respostas — incluindo **schema e dados do banco de desenvolvimento**. Dado que o banco de dev contém anamnese real do fundador, isso não é puramente teórico.

**Por que o CI não pegou:** o gate é `pnpm audit --audit-level=high` (`ci.yml:279`), que ignora `moderate` por definição. A escolha é razoável para evitar ruído, mas cria um ponto cego permanente para tudo que nunca escalar de moderate.

**Impacto:** DoS de baixa amplificação na API; leitura do banco de desenvolvimento por site malicioso durante uso do `drizzle-studio`.

**Correção completa:**

**(a)** Forçar a resolução de `qs` via override do pnpm (o Express ainda não publicou release com a versão corrigida):
```yaml
# pnpm-workspace.yaml
overrides:
  qs: '>=6.16.0'
```
Depois: `pnpm install` e rodar a suíte de integração — `qs` está no caminho quente do parsing de request, então a regressão precisa ser verificada, não presumida.

**(b)** `esbuild`: atualizar o `drizzle-kit` para uma versão que não dependa dos `@esbuild-kit/*` (arquivados e substituídos por `tsx`):
```bash
pnpm --filter @movivo/api up drizzle-kit@latest
```
Se não houver versão disponível: aceitar o risco formalmente **e** nunca rodar `db:studio` com o navegador de uso geral aberto — ou fazer o bind em `127.0.0.1` com um perfil de navegador dedicado.

**(c)** Baixar o gate do CI para `moderate` e tratar exceções explicitamente, de modo que aceitar risco vire uma decisão registrada e não um silêncio:
```yaml
- name: pnpm audit (bloqueia MODERATE+)
  run: pnpm audit --audit-level=moderate
```
Com `pnpm.auditConfig.ignoreGhsas` no `pnpm-workspace.yaml` listando, com justificativa e data de revisão, os advisories conscientemente aceitos.

**(d) Positivo a registrar:** `next@16.3.4` está **acima** de `16.3.3`, a versão que corrigiu CVE-2026-75604 (RCE via filesystem Windows) e a RCE via `libheif`/AVIF do release de agosto/2026. A stack está em dia com os advisories críticos do framework. As CVEs de julho/2026 (CVE-2026-64642, bypass de middleware com Turbopack + i18n; CVE-2026-64645, SSRF via `rewrites()`) **não se aplicam**: o projeto usa webpack explicitamente (`next.config.ts:8-21`), não usa `i18n`, e não define `rewrites()`/`redirects()`.

---

## 6. 🔵 BAIXO

### B-01 — Exceção não tratada no webhook de pagamento expõe estado interno

**Vulnerabilidade:** CWE-209 (Generation of Error Message Containing Sensitive Information) / CWE-248 (Uncaught Exception).

**Local:** `apps/api/src/modules/subscription/payment/real-gateways.ts:46-53` combinado com `apps/api/src/modules/subscription/payment-webhook.service.ts:74`

**Como é explorável:** `RealGatewayBase.parseWebhookEvent` **lança** `PaymentGatewayError` em vez de retornar `null`. Em `payment-webhook.service.ts:74` a chamada não está protegida por `try/catch`, e o `ingest()` promete no próprio docstring (linha 58) *"Nunca lança ao chamador"*. Com `PAYMENT_PROVIDER=STRIPE` configurado antes de a implementação real existir, qualquer requisição não autenticada a `POST /api/v1/webhook/payment` retorna **500** com a mensagem `STRIPE.parseWebhookEvent: gateway real ainda não implementado (mocks-first)` — revelando provedor, estado de implementação e stack interno a quem estiver sondando. Também quebra o contrato de status uniforme (401) que o próprio módulo estabelece para não vazar qual camada falhou.

**Impacto:** Divulgação de informação a atacante em reconhecimento; quebra do contrato de resposta uniforme; log de erro poluído mascarando ataques reais.

**Correção completa:** Envolver a chamada, preservando o contrato de não lançar:

```ts
// payment-webhook.service.ts
let event: GatewayEvent | null;
try {
  event = this.gateway.parseWebhookEvent(input.rawBody, input.signature, input.timestamp);
} catch (error) {
  this.logger.error(
    { event: 'gateway_parse_error', gateway: this.gateway.name, err: safeErrorCode(error) },
    'falha ao parsear evento de pagamento',
  );
  return this.reject('parse_error', input.correlationId);   // 401 uniforme
}
if (!event) return this.reject('bad_signature', input.correlationId);
```

Complementarmente, implementar um `ExceptionFilter` global que em produção nunca serialize `error.message` de exceções não-HTTP.

---

### B-02 — JWT sem validação de `issuer` e `audience`

**Vulnerabilidade:** CWE-1270 (Generation of Incorrect Security Tokens).

**Local:**
- `apps/api/src/modules/auth/jwt.strategy.ts:78-85` — `StrategyOptionsWithoutRequest` sem `issuer`/`audience`
- `apps/api/src/modules/auth/token.service.ts:42-48` — `jwt.sign` sem `issuer`/`audience`

**Como é explorável:** Não é explorável hoje — há uma única chave RS256, controlada exclusivamente pela MOVIVO. O risco é futuro: se a mesma chave (ou o mesmo KMS/HSM) vier a ser usada por outro serviço, ou se um ambiente de staging compartilhar material de chave com produção, um token emitido para um contexto passa a ser aceito no outro. É defesa em profundidade padrão (RFC 8725, §3.1) e custa duas linhas.

**Impacto:** Reuso de token entre contextos num cenário futuro de múltiplos serviços/ambientes.

**Correção completa:**

```ts
// token.service.ts
const token = jwt.sign({ role }, jwtConfig.privateKey, {
  algorithm: jwtConfig.algorithm,
  subject: userId,
  jwtid: jti,
  keyid: jwtConfig.keyId,
  issuer: 'movivo-api',
  audience: `movivo-${this.config.appEnv}`,   // separa prod de staging
  expiresIn: jwtConfig.accessTtl as jwt.SignOptions['expiresIn'],
});
```
```ts
// jwt.strategy.ts
const options: StrategyOptionsWithoutRequest = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  ignoreExpiration: false,
  algorithms: ['RS256'],
  issuer: 'movivo-api',
  audience: `movivo-${config.appEnv}`,
  secretOrKeyProvider: buildSecretOrKeyProvider(keys),
};
```
Implantar em duas etapas: primeiro emitir com `iss`/`aud`, depois (após expirarem os tokens antigos de 15min) passar a validar.

---

### B-03 — Redirect de short-link sem allowlist de origem

**Vulnerabilidade:** CWE-601 (URL Redirection to Untrusted Site).

**Local:**
- `apps/api/src/modules/short-link/short-link.service.ts:82-90` — `resolve()` devolve `targetUrl` sem validação
- `apps/web/src/app/check-in/[code]/route.ts:18` — `NextResponse.redirect(target, 302)`
- Idem em `apps/web/src/app/renovacao/[code]/route.ts` e `apps/web/src/app/semana/[code]/route.ts`

**Como é explorável:** Não explorável hoje: `create()` só é chamado internamente por schedulers, e o controller expõe apenas `@Get(':code')` (`short-link.controller.ts:24`) — não há caminho para o usuário definir `targetUrl`. O risco é de evolução: se algum dia um fluxo permitir que um valor influenciado pelo usuário chegue a `create()`, o resultado é um open redirect sob o domínio da MOVIVO — usável em phishing ("o link é movivo.com.br, é legítimo") e capaz de vazar o token do magic-link pelo header `Referer` para um destino externo.

**Impacto:** Open redirect futuro; phishing com credibilidade do domínio; vazamento de token via `Referer`.

**Correção completa:** Validar na **resolução** (não só na criação), porque é ali que a garantia é barata e definitiva:

```ts
// apps/web/src/app/check-in/[code]/route.ts
const target = await resolveShortLink(code);
if (!target) return NextResponse.json({ error: 'link_expirado' }, { status: 410 });

const allowed = new URL(publicEnv.siteUrl).origin;
let parsed: URL;
try {
  parsed = new URL(target);
} catch {
  return NextResponse.json({ error: 'link_invalido' }, { status: 400 });
}
if (parsed.origin !== allowed) {
  // Só acontece por bug ou por escrita indevida no banco — é sinal de incidente.
  console.error('short-link com destino fora do domínio', { code, origin: parsed.origin });
  return NextResponse.json({ error: 'link_invalido' }, { status: 400 });
}
return NextResponse.redirect(parsed.toString(), 302);
```
Adicionar também `Referrer-Policy: no-referrer` nessas rotas, já que o destino carrega token no fragmento/path.

---

### B-04 — `trust proxy: 1` sem garantia de número de hops

**Vulnerabilidade:** CWE-348 (Use of Less Trusted Source).

**Local:** `apps/api/src/main.ts:100` — `app.set('trust proxy', 1)`

**Como é explorável:** `trust proxy: 1` faz o Express aceitar o último valor de `X-Forwarded-For` como IP real. Correto **se e somente se** houver exatamente um proxy à frente. Numa topologia com Cloudflare **e** nginx (dois hops, arranjo comum), o Express passa a confiar num valor que o cliente pode influenciar — e como todo rate limiting é por IP (`auth.controller.ts:59`, webhooks), um atacante que controle o `X-Forwarded-For` obtém limite efetivamente infinito rotacionando IPs forjados. Também corrompe a atribuição de IP nos logs de auditoria.

Como não pude inspecionar a topologia de produção (ver Limitações §2), não sei se `1` é o valor certo.

**Impacto:** Bypass completo de rate limiting por IP; poluição da trilha de auditoria.

**Correção completa:**
1. Contar os hops reais em produção e ajustar o número (Cloudflare + nginx = `2`).
2. Melhor: com Cloudflare, ignorar `X-Forwarded-For` e usar o header assinado pela borda:
```ts
app.set('trust proxy', (ip: string) => CLOUDFLARE_IP_RANGES.some((cidr) => inCidr(ip, cidr)));
```
3. Alternativa robusta para o throttler — chavear pelo `CF-Connecting-IP`, que só a Cloudflare define e que ela sobrescreve se o cliente tentar forjar:
```ts
@Injectable()
export class CloudflareThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return (req.headers['cf-connecting-ip'] as string) ?? req.ip;
  }
}
```
4. Garantir no nginx que `X-Forwarded-For` de entrada seja **substituído**, nunca concatenado, para requisições que não venham da borda confiável.

---

### B-05 — GitHub Actions referenciadas por tag mutável em vez de SHA

**Vulnerabilidade:** OWASP A08:2021 (Software and Data Integrity Failures) / CWE-494 (Download of Code Without Integrity Check).

**Local:** `.github/workflows/ci.yml` — `actions/checkout@v7`, `pnpm/action-setup@v6`, `actions/setup-node@v7`, `actions/cache@v6`, `actions/upload-artifact@v7`

**Como é explorável:** Tags Git são mutáveis. Se a conta de um mantenedor de action for comprometida, a tag `v7` pode ser reapontada para código malicioso, que passa a executar em todo job do CI da MOVIVO sem que nenhum arquivo do repositório mude. É o vetor do incidente `tj-actions/changed-files` (março/2025), que afetou mais de 23.000 repositórios.

Atenuante significativo: o workflow já aplica `permissions: contents: read` globalmente (`ci.yml:33-34`), sem `id-token` nem `packages: write`. O estrago possível é limitado — não há token de escrita nem credencial de deploy a roubar. Por isso BAIXO.

Risco residual real: os jobs materializam segredos locais (`ci.yml:134` roda `gen-local-secrets.sh`) e têm acesso ao código-fonte completo.

**Impacto:** Execução de código arbitrário no CI numa futura versão comprometida; exfiltração do código-fonte.

**Correção completa:** Fixar por SHA de commit, mantendo a tag em comentário para legibilidade:

```yaml
- uses: actions/checkout@08c6903cd8c0fde910a37f88322edcfb5dd907a8  # v7.0.0
- uses: pnpm/action-setup@a7487c7e89a18df4991f7f222e4898a00d66ddda # v6.0.0
- uses: actions/setup-node@2028fbc5c25fe9cf00d9f06a71cc4710d4507903 # v7.0.0
```

Habilitar o Dependabot para `github-actions`, que atualiza SHAs automaticamente via PR:

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: 'github-actions'
    directory: '/'
    schedule: { interval: 'weekly' }
```

Considerar também `permissions: {}` no nível do workflow, elevando por job apenas onde necessário.

---

## 7. ⚪ INFORMATIVO / HARDENING

### I-01 — Nenhum Dockerfile de produção existe

Não há `Dockerfile` no repositório — apenas `docker-compose.yml` para infraestrutura local (Postgres, PgBouncer, Redis, Sentinel, EvolutionAPI). Não é uma vulnerabilidade; é trabalho pendente da Fase 6 (Henrique). Registro os requisitos de segurança agora para que nasçam corretos:

- Multi-stage build; imagem final `node:22-alpine` ou `distroless`;
- `USER node` explícito — **nunca root**;
- `--frozen-lockfile` e `NODE_ENV=production` (poda devDependencies);
- `read_only: true` + `tmpfs` para `/tmp`; `cap_drop: [ALL]`;
- `security_opt: [no-new-privileges:true]` — já aplicado no compose atual (`docker-compose.yml:48-49`), manter;
- `HEALTHCHECK` apontando para `/api/v1/health`;
- Segredos por `/run/secrets` (tmpfs), nunca por `ENV` nem `ARG` (que persistem nas camadas da imagem);
- Scan de imagem com Trivy/Grype no CI, bloqueando HIGH/CRITICAL;
- **Atenção específica**: `apps/api/uploads/` precisa ser volume nomeado persistente. A memória do projeto registra que um `rm -rf` de "limpeza" já destruiu conteúdo real desse diretório — ele é runtime, não scratch.

### I-02 — `style-src-attr 'unsafe-inline'` na CSP

`apps/web/src/proxy.ts:32`. Necessário para estilos inline do React/Radix. Permite apenas atributos `style=""`, não `<style>` nem scripts — o risco é marginal (exfiltração via CSS é teórica e de baixíssima largura de banda). Aceitável. Registrado para que uma futura auditoria externa não o trate como achado novo.

### I-03 — Ausência de MFA nas contas do Control Center

Não há segundo fator. As contas do dashboard acessam dado de saúde de **todos** os titulares. Com poucos usuários internos (5 fundadores + profissional CREF), o custo de implantação é baixo e o ganho é alto. Recomendo **passkeys/WebAuthn** em vez de TOTP: resistente a phishing por construção, melhor UX, e o suporte a WebAuthn no Next.js 16 é maduro (`@simplewebauthn/server` + `@simplewebauthn/browser`). Pré-requisito natural do step-up de autenticação exigido por **A-05**.

### I-04 — Rotação da chave pgcrypto documentada mas não implementada

`apps/api/src/core/database/health-cipher.service.ts:19-25` descreve o runbook de rotação anual e declara honestamente que o re-encrypt em massa não existe — trocar a chave hoje torna todo o dado de saúde ilegível. Implementar antes que o volume de dados torne a migração cara: job auditável que decifra com a chave N-1 e recifra com a N, em lotes, com `pgcrypto_key_version` por linha para permitir rotação sem downtime. Fazer isso com 0 usuários é trivial; com 10.000, é um projeto.

### I-05 — Contador de 403 do BFF em memória

`apps/web/src/app/api/dashboard/_lib/bff.ts:252-267`. O próprio código documenta a limitação: some em cold start e não é compartilhado entre instâncias. É defesa best-effort contra enumeração de rotas, e a autorização real é do backend (correto). Mover para o Redis quando houver mais de uma instância do `apps/web`.

### I-06 — Sem SBOM nem assinatura de artefatos

Não há geração de SBOM (CycloneDX/SPDX) nem assinatura de build. Recomendo para o go-live, especialmente pela trajetória de conformidade (ISO 27001 / SOC 2) e porque um app de saúde será cobrado nisso por parceiros B2B:
```yaml
- name: Gerar SBOM
  run: pnpm dlx @cyclonedx/cyclonedx-npm --output-file sbom.json
- uses: actions/attest-build-provenance@v3
  with: { subject-path: 'sbom.json' }
```

---

## 8. Plano de mitigação priorizado

### Bloqueadores de lançamento — nenhum usuário real antes disto

| # | Achado | Esforço | Por quê primeiro |
|---|---|---|---|
| 1 | **C-01** — fail-closed no gateway de pagamento + remover segredo hardcoded | 2-3h | Fraude de receita trivial; correção pequena e de baixo risco |
| 2 | **C-02** — desarmar as 6 flags de HEALTH | 15min | Para o vazamento em curso **hoje**; reabrir só com DPA arquivado |
| 3 | **A-01** — schema Zod no evento de pagamento | 2h | Fecha C-01 em profundidade e protege o Stripe real |
| 4 | **A-02** — estender matcher da CSP | 30min | Maior ganho por minuto de esforço de todo o relatório |
| 5 | **M-08** — `chmod 600` + corrigir o gerador + rotacionar chaves | 1h | Chaves vivas; rotacionar agora é barato |
| 6 | **A-04** + **M-01** — HSTS e helmet | 1-2h | Dois `pnpm add` e um bloco de config |

### Antes do go-live público

| # | Achado | Esforço |
|---|---|---|
| 7 | **A-05** — runbook manual de direitos do titular (obrigatório) + iniciar implementação | 4h + 3d |
| 8 | **M-02** — throttler no Redis, centralizado no CoreModule | 3h |
| 9 | **M-03** — lockout por conta com backoff exponencial | 4h |
| 10 | **M-05** — confirmar preimage HMAC da AraraHQ contra entrega real | 2-4h |
| 11 | **M-06** — proibir EvolutionAPI em produção por schema + allowlist de IP | 1h |
| 12 | **M-09** — override de `qs`, atualizar `drizzle-kit`, baixar gate para moderate | 2h |
| 13 | **M-04** — magic bytes + re-encode com sharp + nosniff | 4h |
| 14 | **M-07** — revisar ou vendorizar `js-rich-body-highlighter`; desabilitar postinstall | 2-4h |
| 15 | **A-03** — cifrar `conversations.content` + backfill | 1-2d |

### Sprint seguinte

16. **B-01** a **B-05** — tratamento de exceção, `iss`/`aud`, allowlist de redirect, `trust proxy`, SHAs das actions *(~1 dia no total)*
17. **I-03** — passkeys/WebAuthn no Control Center *(pré-requisito de A-05)*
18. **I-01** — Dockerfile endurecido + scan de imagem no CI *(Fase 6, Henrique)*
19. **A-05** completo — anonimização com step-up + portabilidade
20. **I-04**, **I-06** — rotação de chave versionada, SBOM e proveniência

### Validação recomendada após as correções

- **Testes de regressão de segurança** (com Mariana): forja de webhook de pagamento com o segredo mock; tentativa de IDOR cross-tenant no journal; brute force de login pós-lockout; boot com `PAYMENT_PROVIDER` ausente **deve falhar**.
- **DAST** com OWASP ZAP em baseline contra staging.
- **Verificação de headers**: `curl -sI` em `/`, `/anamnese`, `/dashboard`, e na API — confirmar CSP, HSTS, nosniff.
- **Pentest externo** antes de ultrapassar ~500 usuários pagantes, com escopo explícito em: webhook de pagamento, isolamento multi-tenant e prompt injection no AI Coach.
- **DPIA/RIPD** formal com Alexandre (CLO) antes do primeiro usuário real.

---

## 9. Nota final de avaliação

Preciso registrar algo que normalmente não escrevo num relatório de auditoria.

A qualidade de engenharia de segurança deste código é **incomum**. O isolamento por transação sob PgBouncer em transaction mode é um detalhe que a maioria dos times descobre depois de um incidente de vazamento entre titulares — aqui está documentado, testado e correto desde a Sprint 1. A redação de PII pelo *nome do campo* no pino, incluindo o raciocínio de que redigir `biologicalSex` sem redigir `personaSlot` não fecha nada, é o tipo de pensamento que distingue segurança real de checklist. O serializer que remove valores de query string porque um telefone foi visto em claro num log durante validação — isso é aprendizado operacional incorporado ao código.

Os comentários que admitem o que **não** foi verificado (o preimage da AraraHQ, a cifra pendente de `conversations`, o storage em memória do throttler) valem mais que qualquer relatório externo: um time que documenta honestamente suas próprias lacunas é um time que as fecha.

Os dois achados críticos não contradizem isso — eles o confirmam. Ambos são controles **corretamente implementados** que foram desativados: um por um caminho de fallback conveniente demais, outro por seis linhas de `.env`. Esse é o padrão de falha de times que sabem construir segurança mas ainda não construíram a governança que impede alguém (inclusive eles mesmos, com pressa) de desligá-la.

A recomendação estrutural, portanto, não é escrever mais código de segurança. É **tornar impossível desligar o que já existe**: gates que falham no boot em vez de degradar em silêncio, atestados que exigem a evidência documental junto, e verificação em CI de que a configuração de produção corresponde ao que os ADRs afirmam.

Com os seis bloqueadores corrigidos, eu consideraria esta plataforma apta a receber dados de saúde de usuários reais — o que, para um MVP pré-lançamento, é uma avaliação que raramente consigo dar.

---

## 10. Fontes consultadas

**Advisories e CVEs**
- [Next.js — August 2026 Security Release](https://nextjs.org/blog/august-2026-security-release) — CVE-2026-75604 (RCE em filesystem Windows), RCE via `libheif`/AVIF em `sharp`; corrigidos em 16.3.3
- [Next.js — July 2026 Security Release](https://nextjs.org/blog/july-2026-security-release) — CVE-2026-64641 (DoS via Server Actions), CVE-2026-64642 (bypass de middleware, Turbopack + i18n), CVE-2026-64645 (SSRF via `rewrites()`)
- [GHSA-x5fp-wj9c-mxmx](https://github.com/advisories/GHSA-x5fp-wj9c-mxmx) — `qs` array-limit bypass
- [GHSA-4mjr-xmp4-gh2g](https://github.com/advisories/GHSA-4mjr-xmp4-gh2g) — `qs` DoS via `isBuffer` controlado
- [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) — `esbuild` dev server CORS
- [GHSA-q4gf-8mx6-v5v3](https://github.com/vercel/next.js/security/advisories/GHSA-q4gf-8mx6-v5v3) — DoS com Server Components

**Reputação de dependência**
- [js-rich-body-highlighter — jsDelivr](https://www.jsdelivr.com/package/npm/js-rich-body-highlighter)
- [Socket.dev — alerts de pacotes body-highlighter](https://socket.dev/npm/package/react-native-body-highlighter/alerts)
- [Snyk — react-body-highlighter](https://security.snyk.io/package/npm/react-body-highlighter)
- [JFrog — 8 Malicious npm Packages Deliver Chrome Information Stealer](https://jfrog.com/blog/malicious-npm-packages-chrome-browser-information-stealer/) — contexto de risco de supply chain npm

**Ferramentas e referências**
- `pnpm audit` executado localmente em 2026-09-18 (3 moderate, 0 high/critical)
- [CSP Evaluator — Google](https://csp-evaluator.withgoogle.com/)
- [HSTS Preload List](https://hstspreload.org/)
- OWASP Top 10 2021; OWASP API Security Top 10 2023; OWASP Top 10 for LLM Applications
- RFC 8725 — JSON Web Token Best Current Practices
- LGPD (Lei 13.709/2018) — Art. 5º II, Art. 11, Art. 16 I, Art. 18 (V e VI), Art. 33, Art. 46, Art. 48

**Documentos internos**
- `docs/arquitetura/ARQUITETURA.md`
- `docs/arquitetura/decisoes/adr-005-r2-selecao-neutra-de-provedor-llm.md`
- `docs/fitness-ia-whatsapp/10-relatorio-rafael.md`, `11-relatorio-sato.md`
- `CLAUDE.md` — guardrails de linguagem e contexto de produto

> **Nota sobre limites da pesquisa web:** não localizei advisory específico para `@nestjs/core@12.0.1`, `drizzle-orm@0.45.2` ou `argon2@0.45.1` nas buscas realizadas. Ausência de advisory não é prova de ausência de vulnerabilidade — recomendo assinar os feeds de segurança desses projetos e manter o `pnpm audit` bloqueante no CI.

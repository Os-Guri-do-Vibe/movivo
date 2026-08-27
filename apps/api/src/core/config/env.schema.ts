/**
 * Schema Zod do ambiente da API (TASK-0.3.2).
 *
 * Regras que este arquivo materializa:
 *  - **Falha rápida no boot**: nenhuma variável obrigatória tem default. Se faltar,
 *    o processo morre com uma mensagem que nomeia a variável (e, para segredos, o
 *    par `K_FILE` correspondente).
 *  - **Zero default sensível hardcoded**: senhas, chaves e tokens jamais têm `.default()`.
 *  - `ARQUITETURA.md` §12.3 — o runtime nunca fala com o Postgres na 5432; só via
 *    PgBouncer. O schema recusa a 5432 explicitamente.
 *  - `ARQUITETURA.md` §2 / ADR-003 — PgBouncer em transaction mode proíbe prepared
 *    statements. `DATABASE_PREPARE` só aceita `false`.
 */
import { z } from 'zod';

import { SECRET_KEYS } from './resolve-file-secrets';

/** Porta canônica do PgBouncer. A aplicação nunca conecta direto na 5432. */
export const PGBOUNCER_DEFAULT_PORT = 5433;
/** Porta direta do Postgres — proibida para o runtime da API. */
export const POSTGRES_DIRECT_PORT = 5432;

/** Booleano tolerante a `"true"`/`"1"`/`"yes"` vindos de env (env é sempre string). */
const envBoolean = z.union([z.boolean(), z.string()]).transform((value, ctx) => {
  if (typeof value === 'boolean') return value;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  ctx.addIssue({ code: 'custom', message: `valor booleano inválido: "${value}"` });
  return z.NEVER;
});

/** Inteiro positivo vindo de env. */
const envPort = z.coerce.number().int().min(1).max(65535);

/** Lista separada por vírgula, sem entradas vazias. */
const csv = (label: string) =>
  z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    )
    .refine((list) => list.length > 0, { message: `${label} não pode ser uma lista vazia` });

/** `host:port[,host:port]` — endereços dos Sentinels. */
const sentinelHosts = z.string().transform((value, ctx) => {
  const parsed = value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.lastIndexOf(':');
      const host = separator === -1 ? entry : entry.slice(0, separator);
      const port = separator === -1 ? Number.NaN : Number(entry.slice(separator + 1));
      return { host, port };
    });

  if (parsed.length === 0) {
    ctx.addIssue({ code: 'custom', message: 'informe ao menos um `host:porta` de Sentinel' });
    return z.NEVER;
  }
  for (const { host, port } of parsed) {
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
      ctx.addIssue({ code: 'custom', message: `entrada de Sentinel inválida: "${host}:${port}"` });
      return z.NEVER;
    }
  }
  return parsed;
});

/**
 * `natMap` do ioredis (README §"Redis com Sentinel"): mapeia o endereço **anunciado**
 * pelo Sentinel (`redis-master:6379`) para o endereço alcançável pelo cliente. Só é
 * necessário quando a API roda no host, fora da rede `movivo-net`.
 */
const natMap = z.string().transform((value, ctx) => {
  try {
    const parsed: unknown = JSON.parse(value);
    return z.record(z.string(), z.object({ host: z.string().min(1), port: envPort })).parse(parsed);
  } catch {
    ctx.addIssue({
      code: 'custom',
      message: 'REDIS_NAT_MAP deve ser um JSON no formato {"host:porta":{"host":"...","port":N}}',
    });
    return z.NEVER;
  }
});

export const envSchema = z
  .object({
    // ---------------------------------------------------------------- runtime
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.string().min(1).default('local'),
    TZ: z.string().min(1).default('America/Sao_Paulo'),

    // -------------------------------------------------------------------- HTTP
    API_PORT: envPort.default(3001),
    API_GLOBAL_PREFIX: z.string().min(1).default('api/v1'),
    /** Origens permitidas em CORS. Nunca `*` — regra de Sato §9. */
    API_CORS_ORIGINS: csv('API_CORS_ORIGINS'),
    /**
     * Base pública **da própria API** — distinta de `PUBLIC_SITE_URL` (que é o `apps/web`).
     * Usada para montar a URL que provedores externos chamam de volta; hoje só o webhook
     * de entrada da EvolutionAPI (`POST /webhook/set/{instance}`). Como a EvolutionAPI roda
     * em container, `localhost` é reescrito para `host.docker.internal` na hora de registrar
     * (ver `toContainerReachableUrl` em `whatsapp/evolution-transport.ts`).
     */
    API_PUBLIC_URL: z.string().url().default('http://localhost:3001'),

    // ------------------------------------------------------------------ logger
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_REDACT_PII: envBoolean.default(true),

    // ---------------------------------------- Postgres (runtime — via PgBouncer)
    DATABASE_HOST: z.string().min(1),
    DATABASE_PORT: envPort,
    DATABASE_NAME: z.string().min(1),
    DATABASE_USER: z.string().min(1),
    DATABASE_PASSWORD: z.string().min(1),
    DATABASE_SSL: envBoolean.default(false),
    DATABASE_PREPARE: envBoolean.default(false),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
    DATABASE_CONNECT_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(60).default(10),

    // ------------------------------- Postgres (migração — US-0.4, opcional aqui)
    MIGRATION_DATABASE_HOST: z.string().min(1).optional(),
    MIGRATION_DATABASE_PORT: envPort.optional(),
    MIGRATION_DATABASE_USER: z.string().min(1).optional(),
    MIGRATION_DATABASE_PASSWORD: z.string().min(1).optional(),

    // ------------------------------------------------------------------- Redis
    REDIS_SENTINEL_HOSTS: sentinelHosts,
    REDIS_SENTINEL_MASTER_NAME: z.string().min(1),
    REDIS_DB: z.coerce.number().int().min(0).max(15).default(0),
    REDIS_TLS_ENABLED: envBoolean.default(false),
    /** Prefixo raiz de todas as chaves. O isolamento por titular vem do `RedisKeyBuilder`. */
    REDIS_KEY_PREFIX: z.string().min(1).default('movivo'),
    REDIS_PASSWORD: z.string().min(1),
    REDIS_SENTINEL_PASSWORD: z.string().min(1).optional(),
    REDIS_NAT_MAP: natMap.optional(),

    // -------------------------------------- Cifra de dado de saúde (US-1.1)
    /**
     * Chave simétrica do `pgcrypto` para o bloco de saúde (LGPD Art. 11 · Sato §7.3).
     * Obrigatória e sempre via secret (`PGCRYPTO_KEY_FILE`): a Sprint 1 persiste dado
     * sensível, então o boot **falha rápido** sem ela — não há default nem fallback.
     */
    PGCRYPTO_KEY: z.string().min(1),

    // ------------------------------------------------ JWT / AUTH (US-1.4)
    /**
     * Par de chaves RS256 (Sato §9.1 / ADR-006). O algoritmo é fixo em `RS256` —
     * `HS256`/`alg:none` são recusados aqui e re-validados explicitamente no
     * passport-jwt. As chaves vêm sempre de secret (`JWT_*_KEY_FILE`); sem elas o
     * boot falha rápido, como a `PGCRYPTO_KEY`.
     */
    JWT_ALGORITHM: z.literal('RS256').default('RS256'),
    /** `kid` da chave corrente — vai no header do token para rotação sem downtime. */
    JWT_KEY_ID: z.string().min(1).default('movivo-2026-q3'),
    JWT_PRIVATE_KEY: z.string().min(1),
    JWT_PUBLIC_KEY: z.string().min(1),
    /** Chave pública N-1 (opcional): aceita tokens ainda válidos assinados antes da rotação. */
    JWT_PUBLIC_KEY_PREVIOUS: z.string().min(1).optional(),
    JWT_KEY_ID_PREVIOUS: z.string().min(1).optional(),
    /** TTL do access token (curto — Sato §9.1). Aceita a sintaxe do `ms`/jsonwebtoken. */
    JWT_ACCESS_TTL: z.string().min(1).default('15m'),
    /** TTL do refresh token (cookie httpOnly, 30 dias — ADR-006). */
    JWT_REFRESH_TTL: z.string().min(1).default('30d'),

    // -------------------------------------------------------- LLM (US-2.2)
    /**
     * Chaves de API dos provedores (ADR-005-R2). **Opcionais** (diferente de JWT/pgcrypto):
     * sem elas o app boota, o `LLMRouter` loga um aviso, e só uma chamada REAL sem chave
     * lança erro claro. Assim CI e o `int-spec` que cria o AppModule ficam verdes sem chave.
     */
    DEEPSEEK_API_KEY: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    /** Cascata de qualidade: DeepSeek competitivo → provedores independentes de fallback. */
    LLM_PRIMARY_MODEL: z.string().min(1).default('deepseek-v4-pro'),
    LLM_FALLBACK_MODEL: z.string().min(1).default('gpt-4.1'),
    LLM_SECONDARY_FALLBACK_MODEL: z.string().min(1).default('claude-sonnet-4-5'),
    /**
     * Atestado operacional, neutro por fornecedor. `true` significa que Jurídico/Segurança
     * verificaram DPA, transferência internacional, retenção/no-training e suboperadores.
     */
    LLM_DEEPSEEK_HEALTH_DATA_APPROVED: envBoolean.default(false),
    LLM_OPENAI_HEALTH_DATA_APPROVED: envBoolean.default(false),
    LLM_ANTHROPIC_HEALTH_DATA_APPROVED: envBoolean.default(false),
    /** Teto de tokens por chamada (o router faz clamp do `maxTokens` do request). */
    LLM_MAX_TOKENS: z.coerce.number().int().min(1).max(32_000).default(4096),
    /** Timeout hard por tentativa de provedor (Victor §1.2). Vale para chat/check-in
     * (latência importa numa conversa de WhatsApp em tempo real). */
    LLM_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(8000),
    /**
     * Timeout hard só para `PROTOCOL_GENERATION` (achado 2026-08-18: 8s é curto demais
     * pra uma geração real de protocolo estruturado completo — toda tentativa contra o
     * GPT-4.1 real estourava, esgotava os 3 retries e caía no fallback de segurança
     * sempre, mascarado como "validação bloqueou"). É um job de fila em background, sem
     * pressão de UX em tempo real — pode esperar bem mais que o chat.
     */
    LLM_PROTOCOL_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(45_000),
    /** Teto anti-abuso: chamadas por usuário/dia (LLM10 — Sato §9.4). */
    LLM_USER_DAILY_MESSAGE_LIMIT: z.coerce.number().int().min(1).default(50),
    /** Baseline do budget alert de custo por usuário/dia em BRL (LLM10). */
    LLM_DAILY_COST_ALERT_BRL: z.coerce.number().positive().default(0.5),
    /** Câmbio USD→BRL para o cálculo de custo por chamada (Victor §8). */
    LLM_USD_BRL_RATE: z.coerce.number().positive().default(5.5),

    // ------------------------------------------ WhatsApp / AraraHQ (US-2.5)
    /**
     * Credencial da AraraHQ (WhatsApp outbound). **Opcional** (como as chaves de LLM):
     * sem ela o app boota e o envio real vira no-op logado — os testes injetam um fake
     * transport. Webhook de ENTRADA é Sprint 3.
     */
    ARARAHQ_API_KEY: z.string().min(1).optional(),
    ARARAHQ_BASE_URL: z.string().url().default('https://api.ararahq.com'),
    /**
     * Segredo do webhook de ENTRADA da AraraHQ (US-3.1 / Sato §6). **Opcional** no boot
     * (como `ARARAHQ_API_KEY`): sem ele o app sobe, mas todo inbound é descartado
     * fail-closed (não há como verificar o HMAC). O formato real de assinatura da AraraHQ
     * é desconhecido (conta não assinada) — o placeholder de verificação está isolado em
     * `whatsapp/webhook-signature.ts`, pronto para o formato real plugar. Via secret.
     */
    ARARAHQ_WEBHOOK_SECRET: z.string().min(1).optional(),
    /** Base pública para o deep-link da página read-only do protocolo (US-2.6). */
    PUBLIC_SITE_URL: z.string().url().default('http://localhost:3000'),
    /**
     * Nome do Template aprovado pela Meta com `headerType: 'document'`, usado como
     * fallback do PDF do protocolo (US-2.6-PDF, `AraraHttpTransport.sendDocument`) quando
     * a janela de 24h está fechada. **Opcional**: sem ele, entrega de PDF fora da janela
     * falha (loga e o BullMQ reenvia) até o Template existir e ser aprovado pela Meta.
     */
    WHATSAPP_PROTOCOL_PDF_TEMPLATE_NAME: z.string().min(1).optional(),

    // ------------------------------------------ EvolutionAPI (painel "Sistema →
    // Integração" — conexão via QR Code/Baileys, protocolo não-oficial). Chave
    // **opcional**: sem ela o painel mostra "não configurado" e a criação de
    // instância falha com erro claro.
    EVOLUTION_API_URL: z.string().url().default('http://localhost:8081'),
    EVOLUTION_API_KEY: z.string().min(1).optional(),
    /**
     * Segredo do webhook de ENTRADA da EvolutionAPI (US-3.1-EVO). É um segredo **novo e
     * exclusivo**, nunca a `EVOLUTION_API_KEY`: o envelope que a EvolutionAPI entrega
     * carrega o `apikey` da instância no CORPO de toda entrega (achado de Sato lendo o
     * container real), então autenticar com ele seria autenticar com um valor que o
     * próprio payload publica. Vai como header customizado em `POST /webhook/set/{...}`
     * e volta em toda entrega (`x-movivo-webhook-token`).
     *
     * `min(43)` = 32 bytes de entropia em base64url. Gere com `openssl rand -base64 32`
     * (ou use `scripts/gen-local-secrets.sh`, que cria `secrets/evolution_webhook_token`).
     *
     * **Sem `.default()` de propósito**: `undefined` é o que ativa o fail-closed da borda
     * (`EvolutionInboundEdge.verify` → `no_secret`). Um default silencioso viraria um
     * segredo conhecido publicamente. Via contrato `*_FILE` (docs/SECURITY.md §2).
     */
    EVOLUTION_WEBHOOK_TOKEN: z.string().min(43).optional(),
    /**
     * Qual transporte processa o envio real do `whatsapp-outbound` worker. Default
     * `ARARA` (BSP oficial, produção) — nunca muda sozinho. `EVOLUTION` é só pra testar
     * o fluxo completo no número de teste (separado do chip oficial) enquanto a
     * criação de Template está bloqueada na AraraHQ; ativa também o atraso "humano" de
     * 15-20s anti-ban só nesse transporte (`whatsapp/evolution-transport.ts`). Mesmo
     * padrão de troca de provedor por env já usado em `PAYMENT_PROVIDER`.
     */
    WHATSAPP_TRANSPORT_PROVIDER: z.enum(['ARARA', 'EVOLUTION']).default('ARARA'),

    // -------------------------------------------------------- RAG (US-3.3)
    /**
     * Threshold de cosseno do retrieval denso (Victor §4.2). Default 0.75 é a calibração do
     * `text-embedding-3-small` real; o embedding fake de dev tem outra distribuição, então
     * o teste ajusta este valor (a nota de calibração fica com a impl real).
     */
    RAG_MIN_COSINE: z.coerce.number().min(0).max(1).default(0.75),
    /** Score mínimo pós-rerank (Victor §4.3). */
    RAG_RERANK_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.5),
    /** Trechos retornados após rerank. */
    RAG_TOP_K: z.coerce.number().int().min(1).max(10).default(3),
    /** Candidatos da busca densa antes do rerank (retrieve 20 → rerank → top-K). */
    RAG_CANDIDATES: z.coerce.number().int().min(1).max(100).default(20),

    // -------------------------- Base de conhecimento (formatos complexos fail-closed)
    KNOWLEDGE_OPENAI_EMBEDDING_HEALTH_DATA_APPROVED: envBoolean.default(false),
    KNOWLEDGE_COMPLEX_FORMATS_ENABLED: envBoolean.default(false),
    KNOWLEDGE_ALLOWED_MIME_TYPES: csv('KNOWLEDGE_ALLOWED_MIME_TYPES').default([
      'text/plain',
      'text/markdown',
    ]),
    KNOWLEDGE_UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1_024)
      .max(10 * 1024 * 1024)
      .default(512 * 1024),

    // -------------------------------------------- Pagamento (US-4.1)
    /**
     * Gateway ativo. `MOCK` (default) roda em dev/CI sem conta real; `STRIPE`/`ASAAS` usam o
     * adaptador real SE a chave existir, senão o factory cai no MOCK com aviso (como o LLM).
     * Trocar de provedor é config, não refactor — o SDK/HTTP fica confinado ao gateway.
     */
    PAYMENT_PROVIDER: z.enum(['MOCK', 'STRIPE', 'ASAAS']).default('MOCK'),
    /** Chaves dos gateways — **opcionais** no boot (via `*_FILE`/Secret). Sem elas → MOCK. */
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
    ASAAS_API_KEY: z.string().min(1).optional(),
    ASAAS_WEBHOOK_SECRET: z.string().min(1).optional(),
    /**
     * Janela de graça (dias) do `PAST_DUE` antes de restringir o acesso (US-4.2.3, decisão do
     * fundador: dunning conversacional no WhatsApp durante a graça, só depois restringe).
     */
    SUBSCRIPTION_PAST_DUE_GRACE_DAYS: z.coerce.number().int().min(0).max(30).default(3),

    /** Somente seed local; carregada exclusivamente por DEV_PROFESSIONAL_PASSWORD_FILE. */
    DEV_PROFESSIONAL_PASSWORD: z.string().min(12).optional(),
  })
  .superRefine((config, ctx) => {
    if (config.DATABASE_PORT === POSTGRES_DIRECT_PORT) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_PORT'],
        message:
          `o runtime da API não pode conectar na ${POSTGRES_DIRECT_PORT} (Postgres direto). ` +
          `Use ${PGBOUNCER_DEFAULT_PORT} (PgBouncer, transaction mode) — ARQUITETURA.md §12.3. ` +
          'A 5432 é exclusiva do caminho de migração com a role movivo_migrator.',
      });
    }

    if (config.DATABASE_PREPARE) {
      ctx.addIssue({
        code: 'custom',
        path: ['DATABASE_PREPARE'],
        message:
          'PgBouncer em transaction mode não suporta prepared statements. ' +
          'DATABASE_PREPARE deve ser false (ADR-003 / ARQUITETURA.md §2).',
      });
    }

    if (config.API_CORS_ORIGINS.includes('*')) {
      ctx.addIssue({
        code: 'custom',
        path: ['API_CORS_ORIGINS'],
        message: 'CORS com "*" é proibido. Liste as origens explicitamente (Sato §9).',
      });
    }

    // Gate operacional: parsers isolados/AV/CDR ainda não existem. Nenhuma flag pode
    // transformar essa ausência em suporte inseguro a PDF/DOCX/XLSX/imagem.
    if (config.KNOWLEDGE_COMPLEX_FORMATS_ENABLED) {
      ctx.addIssue({
        code: 'custom',
        path: ['KNOWLEDGE_COMPLEX_FORMATS_ENABLED'],
        message: 'deve permanecer false até existir parser isolado + AV/CDR homologado',
      });
    }
    const safeKnowledgeMimes = new Set(['text/plain', 'text/markdown']);
    const unsupportedKnowledgeMimes = config.KNOWLEDGE_ALLOWED_MIME_TYPES.filter(
      (mime) => !safeKnowledgeMimes.has(mime),
    );
    if (unsupportedKnowledgeMimes.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['KNOWLEDGE_ALLOWED_MIME_TYPES'],
        message: `formatos sem parser seguro: ${unsupportedKnowledgeMimes.join(', ')}`,
      });
    }
    if (config.KNOWLEDGE_UPLOAD_MAX_BYTES > 512 * 1024) {
      ctx.addIssue({
        code: 'custom',
        path: ['KNOWLEDGE_UPLOAD_MAX_BYTES'],
        message: 'não pode exceder 524288 enquanto blobs permanecem no Postgres',
      });
    }
  });

/** Configuração validada e tipada da aplicação. */
export type AppConfig = z.infer<typeof envSchema>;

/** Nome da variável a citar numa mensagem de erro: cita o par `K_FILE` quando sensível. */
function describeMissingKey(key: string): string {
  return (SECRET_KEYS as readonly string[]).includes(key) ? `${key}_FILE ou ${key}` : key;
}

/**
 * Traduz o erro do Zod numa mensagem de boot acionável — nomeia cada variável e,
 * para segredos, os **dois** nomes aceitos (docs/SECURITY.md §2.1.3). Nenhum valor é
 * impresso: o Zod recebe apenas nomes de chave e nós nunca ecoamos `input`.
 */
export function formatEnvError(error: z.ZodError<unknown>): string {
  const lines = error.issues.map((issue) => {
    const key = issue.path.map(String).join('.') || '(raiz)';
    return `  · ${describeMissingKey(key)}: ${issue.message}`;
  });

  return [
    'Configuração de ambiente inválida — a API não vai subir (fail-fast, TASK-0.3.2).',
    ...lines,
    '',
    'Como resolver:',
    '  1. cp apps/api/.env.example apps/api/.env',
    '  2. pnpm run infra:secrets   (gera os arquivos em secrets/, nunca versionados)',
    '  3. pnpm run infra:up',
    'Contrato completo dos segredos: docs/SECURITY.md §2.',
  ].join('\n');
}

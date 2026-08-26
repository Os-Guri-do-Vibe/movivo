/**
 * `AppConfigService` — única porta de acesso à configuração validada.
 *
 * Não usamos `@nestjs/config` de propósito: o `ConfigService` dele faz fallback para
 * `process.env` em tempo de leitura, o que reabriria a porta para um segredo entrar
 * por env direta sem passar pelo contrato `*_FILE` + Zod. Aqui a configuração é
 * imutável, tipada e resolvida uma única vez no boot.
 */
import { Injectable } from '@nestjs/common';

import { type AppConfig } from './env.schema';
import { SECRET_KEYS } from './resolve-file-secrets';

export interface DatabaseConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly ssl: boolean;
  /** Sempre `false`: PgBouncer transaction mode proíbe prepared statements. */
  readonly prepare: false;
  readonly poolMax: number;
  readonly connectTimeoutSeconds: number;
}

export interface JwtConfig {
  readonly algorithm: 'RS256';
  readonly keyId: string;
  readonly privateKey: string;
  readonly publicKey: string;
  /** Chave pública N-1 por `kid`, para aceitar tokens da rotação anterior. */
  readonly previousPublicKey: { readonly keyId: string; readonly key: string } | undefined;
  /** TTLs na sintaxe do jsonwebtoken (`'15m'`, `'30d'`). */
  readonly accessTtl: string;
  readonly refreshTtl: string;
  /** TTL do refresh em segundos, derivado de `refreshTtl` (cookie maxAge / expiração). */
  readonly refreshTtlSeconds: number;
}

/**
 * Converte `15m`/`30d`/`3600s` em segundos. Aceita só o subconjunto que usamos
 * (s/m/h/d) — falhar cedo num formato inesperado é melhor que um `NaN` silencioso
 * virar cookie sem expiração.
 */
export function parseDurationSeconds(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) throw new Error(`Duração inválida: "${value}". Use N seguido de s|m|h|d.`);
  const amount = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const factor = { s: 1, m: 60, h: 3600, d: 86_400 }[unit];
  return amount * factor;
}

export interface LlmConfig {
  readonly primaryModel: string;
  readonly fallbackModel: string;
  readonly maxTokens: number;
  readonly timeoutMs: number;
  /** Timeout só de `PROTOCOL_GENERATION` — job em fila, tolera bem mais que o chat. */
  readonly protocolTimeoutMs: number;
  readonly userDailyMessageLimit: number;
  readonly dailyCostAlertBrl: number;
  readonly usdBrlRate: number;
  /** Chaves opcionais: `undefined` em dev/CI sem segredo. Segredos redigidos no snapshot. */
  readonly openaiApiKey: string | undefined;
  readonly anthropicApiKey: string | undefined;
}

export interface WhatsappConfig {
  /** `undefined` em dev/CI sem segredo → envio real vira no-op logado. Segredo redigido. */
  readonly araraApiKey: string | undefined;
  readonly araraBaseUrl: string;
  /** Base do deep-link da página read-only do protocolo (US-2.6). */
  readonly publicSiteUrl: string;
  /** `undefined` sem segredo → inbound descartado fail-closed (US-3.1). Segredo redigido. */
  readonly webhookSecret: string | undefined;
  /** Transporte ativo do `whatsapp-outbound` worker. Default `ARARA` — ver env.schema.ts. */
  readonly transportProvider: 'ARARA' | 'EVOLUTION';
  /** Template com header de documento p/ fallback do PDF fora da janela de 24h. `undefined` até existir/ser aprovado na Meta. */
  readonly protocolPdfTemplateName: string | undefined;
}

export interface EvolutionConfig {
  readonly baseUrl: string;
  /** `undefined` em dev/CI sem segredo → painel mostra "não configurado". Segredo redigido. */
  readonly apiKey: string | undefined;
  /**
   * Segredo do webhook de ENTRADA (US-3.1-EVO), separado da `apiKey` de propósito.
   * `undefined` → todo inbound da EvolutionAPI é descartado fail-closed. Segredo redigido.
   */
  readonly webhookToken: string | undefined;
}

export interface PaymentConfig {
  /** Gateway ativo. `MOCK` em dev/CI; real só com chave (senão o factory cai no MOCK). */
  readonly provider: 'MOCK' | 'STRIPE' | 'ASAAS';
  /** Segredos redigidos no snapshot; `undefined` sem credencial → adaptador MOCK. */
  readonly stripeSecretKey: string | undefined;
  readonly stripeWebhookSecret: string | undefined;
  readonly asaasApiKey: string | undefined;
  readonly asaasWebhookSecret: string | undefined;
  /** Dias de graça do `PAST_DUE` antes de restringir o acesso (US-4.2.3). */
  readonly pastDueGraceDays: number;
}

export interface RedisConfig {
  readonly sentinels: readonly { readonly host: string; readonly port: number }[];
  readonly masterName: string;
  readonly password: string;
  readonly sentinelPassword: string | undefined;
  readonly db: number;
  readonly tls: boolean;
  readonly keyPrefix: string;
  readonly natMap: Readonly<Record<string, { host: string; port: number }>> | undefined;
}

export interface KnowledgeConfig {
  readonly complexFormatsEnabled: boolean;
  readonly allowedMimeTypes: readonly string[];
  readonly uploadMaxBytes: number;
}

@Injectable()
export class AppConfigService {
  constructor(private readonly config: AppConfig) {}

  get nodeEnv(): AppConfig['NODE_ENV'] {
    return this.config.NODE_ENV;
  }

  get appEnv(): string {
    return this.config.APP_ENV;
  }

  get isProduction(): boolean {
    return this.config.NODE_ENV === 'production';
  }

  get timezone(): string {
    return this.config.TZ;
  }

  get httpPort(): number {
    return this.config.API_PORT;
  }

  get globalPrefix(): string {
    return this.config.API_GLOBAL_PREFIX;
  }

  get corsOrigins(): readonly string[] {
    return this.config.API_CORS_ORIGINS;
  }

  get logLevel(): AppConfig['LOG_LEVEL'] {
    return this.config.LOG_LEVEL;
  }

  get redactPii(): boolean {
    return this.config.LOG_REDACT_PII;
  }

  get database(): DatabaseConfig {
    return {
      host: this.config.DATABASE_HOST,
      port: this.config.DATABASE_PORT,
      database: this.config.DATABASE_NAME,
      user: this.config.DATABASE_USER,
      password: this.config.DATABASE_PASSWORD,
      ssl: this.config.DATABASE_SSL,
      prepare: false,
      poolMax: this.config.DATABASE_POOL_MAX,
      connectTimeoutSeconds: this.config.DATABASE_CONNECT_TIMEOUT_SECONDS,
    };
  }

  /**
   * Chave simétrica do `pgcrypto` (US-1.1 / Sato §7.3). Segredo: já é mascarada em
   * `redactedSnapshot()` (via `SECRET_KEYS`) e nunca deve ser logada por quem a consome.
   */
  get pgcryptoKey(): string {
    return this.config.PGCRYPTO_KEY;
  }

  /** Config do JWT RS256 (US-1.4 / Sato §9.1). As chaves são segredos redigidos no snapshot. */
  get jwt(): JwtConfig {
    const previous =
      this.config.JWT_PUBLIC_KEY_PREVIOUS && this.config.JWT_KEY_ID_PREVIOUS
        ? { keyId: this.config.JWT_KEY_ID_PREVIOUS, key: this.config.JWT_PUBLIC_KEY_PREVIOUS }
        : undefined;
    return {
      algorithm: this.config.JWT_ALGORITHM,
      keyId: this.config.JWT_KEY_ID,
      privateKey: this.config.JWT_PRIVATE_KEY,
      publicKey: this.config.JWT_PUBLIC_KEY,
      previousPublicKey: previous,
      accessTtl: this.config.JWT_ACCESS_TTL,
      refreshTtl: this.config.JWT_REFRESH_TTL,
      refreshTtlSeconds: parseDurationSeconds(this.config.JWT_REFRESH_TTL),
    };
  }

  /** Config da camada de IA (US-2.2 / ADR-005-R). Chaves são segredos redigidos no snapshot. */
  get llm(): LlmConfig {
    return {
      primaryModel: this.config.LLM_PRIMARY_MODEL,
      fallbackModel: this.config.LLM_FALLBACK_MODEL,
      maxTokens: this.config.LLM_MAX_TOKENS,
      timeoutMs: this.config.LLM_TIMEOUT_MS,
      protocolTimeoutMs: this.config.LLM_PROTOCOL_TIMEOUT_MS,
      userDailyMessageLimit: this.config.LLM_USER_DAILY_MESSAGE_LIMIT,
      dailyCostAlertBrl: this.config.LLM_DAILY_COST_ALERT_BRL,
      usdBrlRate: this.config.LLM_USD_BRL_RATE,
      openaiApiKey: this.config.OPENAI_API_KEY,
      anthropicApiKey: this.config.ANTHROPIC_API_KEY,
    };
  }

  /** Config do WhatsApp outbound (US-2.5). `araraApiKey` é segredo redigido no snapshot. */
  get whatsapp(): WhatsappConfig {
    return {
      araraApiKey: this.config.ARARAHQ_API_KEY,
      araraBaseUrl: this.config.ARARAHQ_BASE_URL,
      publicSiteUrl: this.config.PUBLIC_SITE_URL,
      webhookSecret: this.config.ARARAHQ_WEBHOOK_SECRET,
      transportProvider: this.config.WHATSAPP_TRANSPORT_PROVIDER,
      protocolPdfTemplateName: this.config.WHATSAPP_PROTOCOL_PDF_TEMPLATE_NAME,
    };
  }

  /**
   * Config da EvolutionAPI (painel "Sistema → Integração" — ferramenta INTERNA de
   * teste de WhatsApp, não é o canal de produção). `apiKey` é segredo redigido.
   */
  get evolution(): EvolutionConfig {
    return {
      baseUrl: this.config.EVOLUTION_API_URL,
      apiKey: this.config.EVOLUTION_API_KEY,
      webhookToken: this.config.EVOLUTION_WEBHOOK_TOKEN,
    };
  }

  /** Base pública da própria API (callback de provedor externo). Nunca é o `apps/web`. */
  get apiPublicUrl(): string {
    return this.config.API_PUBLIC_URL;
  }

  /** Config do RAG (US-3.3). Thresholds/top-K do retrieval + rerank. */
  get rag(): {
    readonly minCosine: number;
    readonly rerankMinScore: number;
    readonly topK: number;
    readonly candidates: number;
  } {
    return {
      minCosine: this.config.RAG_MIN_COSINE,
      rerankMinScore: this.config.RAG_RERANK_MIN_SCORE,
      topK: this.config.RAG_TOP_K,
      candidates: this.config.RAG_CANDIDATES,
    };
  }

  get knowledge(): KnowledgeConfig {
    return {
      complexFormatsEnabled: this.config.KNOWLEDGE_COMPLEX_FORMATS_ENABLED,
      allowedMimeTypes: this.config.KNOWLEDGE_ALLOWED_MIME_TYPES,
      uploadMaxBytes: this.config.KNOWLEDGE_UPLOAD_MAX_BYTES,
    };
  }

  /** Config de pagamento (US-4.1). Chaves são segredos redigidos no snapshot. */
  get payment(): PaymentConfig {
    return {
      provider: this.config.PAYMENT_PROVIDER,
      stripeSecretKey: this.config.STRIPE_SECRET_KEY,
      stripeWebhookSecret: this.config.STRIPE_WEBHOOK_SECRET,
      asaasApiKey: this.config.ASAAS_API_KEY,
      asaasWebhookSecret: this.config.ASAAS_WEBHOOK_SECRET,
      pastDueGraceDays: this.config.SUBSCRIPTION_PAST_DUE_GRACE_DAYS,
    };
  }

  get redis(): RedisConfig {
    return {
      sentinels: this.config.REDIS_SENTINEL_HOSTS,
      masterName: this.config.REDIS_SENTINEL_MASTER_NAME,
      password: this.config.REDIS_PASSWORD,
      sentinelPassword: this.config.REDIS_SENTINEL_PASSWORD ?? this.config.REDIS_PASSWORD,
      db: this.config.REDIS_DB,
      tls: this.config.REDIS_TLS_ENABLED,
      keyPrefix: this.config.REDIS_KEY_PREFIX,
      natMap: this.config.REDIS_NAT_MAP,
    };
  }

  /**
   * Snapshot seguro para log de boot e diagnóstico.
   *
   * Segredos são omitidos **por construção** (a partir de `SECRET_KEYS`), não por
   * disciplina de quem escreve o código — exigência de `docs/SECURITY.md` §2.1.10. Nunca
   * exponha este objeto em `/health`: ele é para log interno de boot.
   */
  redactedSnapshot(): Record<string, unknown> {
    const secretKeys: readonly string[] = SECRET_KEYS;
    const snapshot: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(this.config)) {
      snapshot[key] = secretKeys.includes(key) ? '[REDACTED]' : value;
    }
    return snapshot;
  }
}

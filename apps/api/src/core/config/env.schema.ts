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
  });

/** Configuração validada e tipada da aplicação. */
export type AppConfig = z.infer<typeof envSchema>;

/** Nome da variável a citar numa mensagem de erro: cita o par `K_FILE` quando sensível. */
function describeMissingKey(key: string): string {
  return (SECRET_KEYS as readonly string[]).includes(key) ? `${key}_FILE ou ${key}` : key;
}

/**
 * Traduz o erro do Zod numa mensagem de boot acionável — nomeia cada variável e,
 * para segredos, os **dois** nomes aceitos (SECURITY.md §2.1.3). Nenhum valor é
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
    'Contrato completo dos segredos: SECURITY.md §2.',
  ].join('\n');
}

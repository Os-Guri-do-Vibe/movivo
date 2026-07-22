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
   * disciplina de quem escreve o código — exigência de `SECURITY.md` §2.1.10. Nunca
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

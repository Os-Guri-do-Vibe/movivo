/**
 * Testes de `AppConfigService` (US-0.8, Mariana).
 *
 * A service é a única porta de leitura da configuração validada. É lógica pura (sem I/O):
 * mapeia o `AppConfig` já validado por Zod para os agrupamentos que o resto do app
 * consome. O que se prova aqui:
 *  - os getters refletem fielmente o config injetado;
 *  - `database.prepare` é **sempre** `false` (PgBouncer transaction mode, ARQUITETURA §12.3);
 *  - `redis.sentinelPassword` cai para a senha do Redis quando ausente;
 *  - `redactedSnapshot()` nunca deixa um segredo escapar (docs/SECURITY.md §2.1.10).
 */
import { describe, expect, it } from 'vitest';

import { AppConfigService } from './app-config.service';
import { type AppConfig } from './env.schema';

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    NODE_ENV: 'test',
    APP_ENV: 'ci',
    TZ: 'America/Sao_Paulo',
    API_PORT: 3001,
    API_GLOBAL_PREFIX: 'api/v1',
    API_CORS_ORIGINS: ['http://localhost:3000'],
    LOG_LEVEL: 'info',
    LOG_REDACT_PII: true,
    DATABASE_HOST: 'localhost',
    DATABASE_PORT: 5433,
    DATABASE_NAME: 'movivo',
    DATABASE_USER: 'movivo_app',
    DATABASE_PASSWORD: 'super-secret-app',
    DATABASE_SSL: false,
    DATABASE_PREPARE: false,
    DATABASE_POOL_MAX: 10,
    DATABASE_CONNECT_TIMEOUT_SECONDS: 10,
    REDIS_SENTINEL_HOSTS: [{ host: 'localhost', port: 26379 }],
    REDIS_SENTINEL_MASTER_NAME: 'movivo-master',
    REDIS_DB: 0,
    REDIS_TLS_ENABLED: false,
    REDIS_KEY_PREFIX: 'movivo',
    REDIS_PASSWORD: 'super-secret-redis',
    ...overrides,
  } as AppConfig;
}

describe('AppConfigService', () => {
  it('expõe os metadados de runtime a partir do config injetado', () => {
    const service = new AppConfigService(makeConfig({ APP_ENV: 'staging' }));
    expect(service.nodeEnv).toBe('test');
    expect(service.appEnv).toBe('staging');
    expect(service.timezone).toBe('America/Sao_Paulo');
    expect(service.httpPort).toBe(3001);
    expect(service.globalPrefix).toBe('api/v1');
    expect(service.logLevel).toBe('info');
    expect(service.redactPii).toBe(true);
    expect(service.corsOrigins).toEqual(['http://localhost:3000']);
  });

  it('isProduction é true apenas em NODE_ENV=production', () => {
    expect(new AppConfigService(makeConfig({ NODE_ENV: 'production' })).isProduction).toBe(true);
    expect(new AppConfigService(makeConfig({ NODE_ENV: 'development' })).isProduction).toBe(false);
  });

  it('database.prepare é sempre false — regra do PgBouncer transaction mode', () => {
    // Mesmo que alguém force `true` no config (o Zod já recusa isso), a service
    // não pode propagar prepared statements para o driver.
    const service = new AppConfigService(
      makeConfig({ DATABASE_PREPARE: true } as Partial<AppConfig>),
    );
    expect(service.database.prepare).toBe(false);
  });

  it('database mapeia host/porta/credenciais fielmente', () => {
    const service = new AppConfigService(makeConfig());
    expect(service.database).toMatchObject({
      host: 'localhost',
      port: 5433,
      database: 'movivo',
      user: 'movivo_app',
      password: 'super-secret-app',
      ssl: false,
      poolMax: 10,
      connectTimeoutSeconds: 10,
    });
  });

  it('redis.sentinelPassword cai para a senha do Redis quando não há senha de Sentinel', () => {
    const service = new AppConfigService(makeConfig());
    expect(service.redis.sentinelPassword).toBe('super-secret-redis');
  });

  it('redis.sentinelPassword usa a senha específica de Sentinel quando definida', () => {
    const service = new AppConfigService(
      makeConfig({ REDIS_SENTINEL_PASSWORD: 'sentinel-only' } as Partial<AppConfig>),
    );
    expect(service.redis.sentinelPassword).toBe('sentinel-only');
  });

  it('redactedSnapshot mascara TODA chave sensível e preserva as demais', () => {
    const snapshot = new AppConfigService(makeConfig()).redactedSnapshot();
    // Segredos mascarados.
    expect(snapshot.DATABASE_PASSWORD).toBe('[REDACTED]');
    expect(snapshot.REDIS_PASSWORD).toBe('[REDACTED]');
    // Metadados operacionais preservados.
    expect(snapshot.DATABASE_HOST).toBe('localhost');
    expect(snapshot.API_PORT).toBe(3001);
    // Nenhum valor de segredo em claro sobrou no snapshot serializado.
    expect(JSON.stringify(snapshot)).not.toContain('super-secret-app');
    expect(JSON.stringify(snapshot)).not.toContain('super-secret-redis');
  });
});

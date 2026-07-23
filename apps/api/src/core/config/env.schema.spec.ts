/**
 * TASK-0.3.2 — a promessa "o app não sobe sem env obrigatória, com mensagem clara"
 * precisa ser executável. Estes testes cobrem o schema; a prova ponta a ponta (boot
 * real falhando) está no README de execução da US-0.3.
 */
import { describe, expect, it } from 'vitest';

import { envSchema, formatEnvError } from './env.schema';

const VALID = {
  API_CORS_ORIGINS: 'http://localhost:3000',
  DATABASE_HOST: 'localhost',
  DATABASE_PORT: '5433',
  DATABASE_NAME: 'movivo',
  DATABASE_USER: 'movivo_app',
  DATABASE_PASSWORD: 'senha-de-teste',
  REDIS_SENTINEL_HOSTS: 'localhost:26379',
  REDIS_SENTINEL_MASTER_NAME: 'movivo-master',
  REDIS_PASSWORD: 'senha-de-teste',
  PGCRYPTO_KEY: 'chave-pgcrypto-de-teste',
} as const;

describe('envSchema', () => {
  it('aceita a configuração mínima e aplica os defaults não sensíveis', () => {
    const result = envSchema.safeParse({ ...VALID });
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.API_PORT).toBe(3001);
    expect(result.data.API_GLOBAL_PREFIX).toBe('api/v1');
    expect(result.data.DATABASE_PREPARE).toBe(false);
    expect(result.data.REDIS_KEY_PREFIX).toBe('movivo');
    expect(result.data.API_CORS_ORIGINS).toEqual(['http://localhost:3000']);
    expect(result.data.REDIS_SENTINEL_HOSTS).toEqual([{ host: 'localhost', port: 26379 }]);
  });

  it('recusa a ausência de um segredo e a mensagem cita K_FILE **e** K', () => {
    const { DATABASE_PASSWORD: _omitted, ...withoutPassword } = VALID;
    const result = envSchema.safeParse(withoutPassword);

    expect(result.success).toBe(false);
    if (result.success) return;

    const message = formatEnvError(result.error);
    expect(message).toContain('DATABASE_PASSWORD_FILE ou DATABASE_PASSWORD');
    expect(message).toContain('fail-fast');
  });

  it('exige PGCRYPTO_KEY (cifra do dado de saúde) e cita o par K_FILE (US-1.1)', () => {
    const { PGCRYPTO_KEY: _omitted, ...withoutKey } = VALID;
    const result = envSchema.safeParse(withoutKey);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(formatEnvError(result.error)).toContain('PGCRYPTO_KEY_FILE ou PGCRYPTO_KEY');
  });

  it('recusa a porta 5432 no runtime — a app só fala com o PgBouncer (§12.3)', () => {
    const result = envSchema.safeParse({ ...VALID, DATABASE_PORT: '5432' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(formatEnvError(result.error)).toContain('5433');
  });

  it('recusa prepared statements ligados (ADR-003)', () => {
    const result = envSchema.safeParse({ ...VALID, DATABASE_PREPARE: 'true' });
    expect(result.success).toBe(false);
  });

  it('recusa CORS com "*"', () => {
    const result = envSchema.safeParse({ ...VALID, API_CORS_ORIGINS: 'http://localhost:3000,*' });
    expect(result.success).toBe(false);
  });

  it('nunca ecoa o valor de um segredo na mensagem de erro', () => {
    const result = envSchema.safeParse({ ...VALID, DATABASE_PASSWORD: '', REDIS_PASSWORD: '' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(formatEnvError(result.error)).not.toContain('senha-de-teste');
  });

  it('faz o parse do natMap do Redis quando informado', () => {
    const result = envSchema.safeParse({
      ...VALID,
      REDIS_NAT_MAP: '{"redis-master:6379":{"host":"127.0.0.1","port":6379}}',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.REDIS_NAT_MAP?.['redis-master:6379']).toEqual({
      host: '127.0.0.1',
      port: 6379,
    });
  });
});

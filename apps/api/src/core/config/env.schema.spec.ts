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
  JWT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nteste\n-----END PRIVATE KEY-----',
  JWT_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\nteste\n-----END PUBLIC KEY-----',
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

  it('exige chave e token de webhook quando o provedor é ASAAS', () => {
    const result = envSchema.safeParse({ ...VALID, PAYMENT_PROVIDER: 'ASAAS' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const message = formatEnvError(result.error);
    expect(message).toContain('ASAAS_API_KEY');
    expect(message).toContain('ASAAS_WEBHOOK_SECRET');
  });

  it('aceita somente os domínios oficiais e reserva o Asaas real ao ambiente de produção', () => {
    const sandbox = envSchema.safeParse({
      ...VALID,
      PAYMENT_PROVIDER: 'ASAAS',
      ASAAS_API_KEY: '$aact_hmlg_teste',
      ASAAS_WEBHOOK_SECRET: 'token-webhook-sandbox-com-32-caracteres',
    });
    expect(sandbox.success).toBe(true);

    const production = {
      ...VALID,
      PAYMENT_PROVIDER: 'ASAAS',
      ASAAS_API_KEY: '$aact_prod_teste',
      ASAAS_WEBHOOK_SECRET: 'token-webhook-producao-com-32-caracteres',
      ASAAS_API_URL: 'https://api.asaas.com/v3',
    };
    expect(envSchema.safeParse(production).success).toBe(false);
    expect(envSchema.safeParse({ ...production, NODE_ENV: 'production' }).success).toBe(false);
    expect(
      envSchema.safeParse({ ...production, NODE_ENV: 'production', APP_ENV: 'production' }).success,
    ).toBe(true);
    expect(
      envSchema.safeParse({
        ...production,
        NODE_ENV: 'production',
        APP_ENV: 'production',
        ASAAS_API_URL: 'https://example.com/v3',
      }).success,
    ).toBe(false);
  });

  it('proíbe o gateway MOCK no processo de produção', () => {
    const result = envSchema.safeParse({ ...VALID, NODE_ENV: 'production' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(formatEnvError(result.error)).toContain('MOCK é proibido em produção');
  });
});

it.each(['0s', '1y', '900000', '16m', '10000000000000000000000000d'])(
  'recusa TTL access inseguro %s',
  (value) => {
    expect(envSchema.safeParse({ ...VALID, JWT_ACCESS_TTL: value }).success).toBe(false);
  },
);
it('recusa refresh acima de 30 dias', () => {
  expect(envSchema.safeParse({ ...VALID, JWT_REFRESH_TTL: '31d' }).success).toBe(false);
});

describe('configuração da cifra de aplicação', () => {
  it('valida keyring sem expor conteúdo e exige ID ativo existente', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const valid = {
      ...VALID,
      HEALTH_CIPHER_KEY_ID: 'v2',
      HEALTH_CIPHER_KEYRING: JSON.stringify({ v1: key, v2: key }),
    };
    expect(envSchema.safeParse(valid).success).toBe(true);
    expect(envSchema.safeParse({ ...valid, HEALTH_CIPHER_KEY_ID: 'absent' }).success).toBe(false);
    for (const ring of ['not-json-secret', '{}', '[]', JSON.stringify({ v2: 'short-secret' })]) {
      const result = envSchema.safeParse({ ...valid, HEALTH_CIPHER_KEYRING: ring });
      expect(result.success).toBe(false);
      if (!result.success) expect(formatEnvError(result.error)).not.toContain(ring);
    }
  });

  it('Vault exige HTTPS, token e origem sem credenciais/query/caminho', () => {
    const vault = {
      ...VALID,
      HEALTH_CIPHER_PROVIDER: 'VAULT',
      VAULT_ADDR: 'https://vault.example/',
      VAULT_TOKEN: 'secret-token',
    };
    expect(envSchema.safeParse(vault).success).toBe(true);
    expect(envSchema.safeParse({ ...vault, VAULT_TOKEN: undefined }).success).toBe(false);
    for (const url of [
      'http://vault.example',
      'https://user:pass@vault.example',
      'https://vault.example/path',
      'https://vault.example/?token=x',
    ]) {
      expect(envSchema.safeParse({ ...vault, VAULT_ADDR: url }).success).toBe(false);
    }
  });
});

it('reserva legacy-derived para manter leitura dos envelopes de transição', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  expect(
    envSchema.safeParse({
      ...VALID,
      HEALTH_CIPHER_KEY_ID: 'v2',
      HEALTH_CIPHER_KEYRING: JSON.stringify({ 'legacy-derived': key, v2: key }),
    }).success,
  ).toBe(false);
});

it('não ignora CA de Postgres/Redis com TLS desligado', () => {
  expect(envSchema.safeParse({ ...VALID, DATABASE_SSL_CA: 'ca' }).success).toBe(false);
  expect(envSchema.safeParse({ ...VALID, REDIS_TLS_CA: 'ca' }).success).toBe(false);
  expect(
    envSchema.safeParse({
      ...VALID,
      DATABASE_SSL: true,
      DATABASE_SSL_CA: 'ca',
      REDIS_TLS_ENABLED: true,
      REDIS_TLS_CA: 'ca',
    }).success,
  ).toBe(true);
});

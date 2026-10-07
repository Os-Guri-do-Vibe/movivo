#!/usr/bin/env node
/**
 * Smoke sem alterar dados/RT: docker compose exec -T api node --input-type=module < scripts/verify-security.mjs
 * Executa no cwd da imagem API (/app/apps/api). Só emite nomes de checks e contagens.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { request as httpsRequest } from 'node:https';
import { connect as tlsConnect, rootCertificates } from 'node:tls';
import { createConnection } from 'node:net';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const require = createRequire(`${process.cwd()}/security-verifier.cjs`);
const { AppConfigService } = require('./dist/core/config/app-config.service');
const { buildAppConfig } = require('./dist/core/config/config.module');
const { createPostgresClient } = require('./dist/core/database/database.module');
const { buildRedisOptions } = require('./dist/core/redis/redis.module');
const { HealthCipherService } = require('./dist/core/database/health-cipher.service');
const { Redis } = require('ioredis');

const cfg = new AppConfigService(buildAppConfig());
const results = [];
const badCa = rootCertificates[0];
const certificateError = (error) =>
  /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/.test(error?.code ?? '');

async function check(name, work) {
  try {
    const evidence = await work();
    results.push({ check: name, status: 'passed', ...(evidence ?? {}) });
  } catch {
    results.push({ check: name, status: 'failed' });
    process.exitCode = 1;
  }
}

async function rejected(work, predicate = () => true) {
  try {
    await work();
  } catch (error) {
    assert(predicate(error), 'falha inesperada em teste negativo');
    return;
  }
  throw new Error('controle negativo aceitou a conexão/operação');
}

function https(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        ca: cfg.healthCipher.vaultCa,
        rejectUnauthorized: true,
        signal: AbortSignal.timeout(5000),
        ...options,
      },
      (response) => {
        const authorized = response.socket?.authorized === true;
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) {
            response.destroy(new Error('resposta excessiva'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('aborted', () => reject(new Error('resposta interrompida')));
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            authorized,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function tls(host, port, ca, servername = host) {
  return new Promise((resolve, reject) => {
    const socket = tlsConnect({ host, port, ca, servername, rejectUnauthorized: true });
    socket.setTimeout(5000, () => socket.destroy(new Error('TLS timeout')));
    socket.on('error', reject);
    socket.on('secureConnect', () => {
      const authorized = socket.authorized;
      socket.destroy();
      if (authorized) resolve();
      else reject(new Error('TLS não autorizado'));
    });
  });
}

function noPlainRedis(host, port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(3000, () => {
      socket.destroy();
      resolve();
    });
    socket.on('connect', () => socket.write('PING\r\n'));
    socket.on('data', () => {
      socket.destroy();
      reject(new Error('endpoint respondeu em plaintext'));
    });
    socket.on('error', (error) => {
      if (error.code === 'ECONNRESET') resolve();
      else reject(error);
    });
    socket.on('end', resolve);
  });
}

await check('configuration_and_independent_keyring', () => {
  assert.equal(cfg.healthCipher.provider, 'VAULT');
  assert.equal(cfg.database.ssl, true);
  assert.equal(cfg.redis.tls, true);
  assert.equal(cfg.httpBindHost, '127.0.0.1');
  assert(cfg.database.sslCa && cfg.redis.tlsCa && cfg.healthCipher.vaultCa);
  assert.equal(cfg.database.sslCa, cfg.redis.tlsCa);
  assert.equal(cfg.database.sslCa, cfg.healthCipher.vaultCa);
  assert(cfg.healthCipher.keyring?.[cfg.healthCipher.keyId]);
  for (const key of Object.values(cfg.healthCipher.keyring)) {
    assert.equal(Buffer.from(key, 'base64').length, 32);
    assert(
      !Buffer.from(key, 'base64').equals(createHash('sha256').update(cfg.pgcryptoKey).digest()),
    );
  }
});

await check('postgres_pool_runtime_tls', async () => {
  const client = createPostgresClient(cfg);
  try {
    const [row] = await client`SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid()`;
    assert.equal(row?.ssl, true); // prova o hop PgBouncer -> PostgreSQL
    assert(['TLSv1.2', 'TLSv1.3'].includes(row.version));
    return { backendTls: row.version };
  } finally {
    await client.end({ timeout: 2 });
  }
});

await check('postgres_pool_rejects_wrong_ca', async () => {
  const client = createPostgresClient({
    database: { ...cfg.database, sslCa: badCa, connectTimeoutSeconds: 2 },
  });
  try {
    await rejected(() => client`SELECT 1`, certificateError);
  } finally {
    await client.end({ timeout: 2 });
  }
});

await check('postgres_pool_rejects_plaintext', async () => {
  const client = createPostgresClient({
    database: { ...cfg.database, ssl: false, sslCa: undefined, connectTimeoutSeconds: 2 },
  });
  try {
    await rejected(
      () => client`SELECT 1`,
      (error) => /SSL required|TLS required|requires SSL/i.test(error.message ?? ''),
    );
  } finally {
    await client.end({ timeout: 2 });
  }
});

let master;
const redis = new Redis({
  ...buildRedisOptions(cfg),
  lazyConnect: true,
  retryStrategy: null,
  sentinelRetryStrategy: () => null,
});
redis.on('error', () => {});
await check('redis_discovery_tls_and_ping', async () => {
  await redis.connect();
  assert.equal(await redis.ping(), 'PONG');
  assert(redis.connector.stream.encrypted && redis.connector.stream.authorized);
});
redis.disconnect();

for (const endpoint of cfg.redis.sentinels) {
  const sentinel = new Redis({
    host: endpoint.host,
    port: endpoint.port,
    password: cfg.redis.sentinelPassword,
    tls: { ca: cfg.redis.tlsCa, rejectUnauthorized: true },
    lazyConnect: true,
    retryStrategy: null,
    connectTimeout: 3000,
  });
  sentinel.on('error', () => {});
  await check('sentinel_tls_discovery', async () => {
    try {
      await sentinel.connect();
      const address = await sentinel.sentinel('get-master-addr-by-name', cfg.redis.masterName);
      assert(Array.isArray(address) && address.length === 2);
      master = { host: address[0], port: Number(address[1]) };
      assert(sentinel.connector.stream.encrypted && sentinel.connector.stream.authorized);
    } finally {
      sentinel.disconnect();
    }
  });
  await check('sentinel_rejects_wrong_ca', () =>
    rejected(() => tls(endpoint.host, endpoint.port, badCa), certificateError),
  );
  await check('sentinel_rejects_wrong_hostname', () =>
    rejected(
      () => tls(endpoint.host, endpoint.port, cfg.redis.tlsCa, 'wrong-host.invalid'),
      certificateError,
    ),
  );
  await check('sentinel_plaintext_not_accepted', () => noPlainRedis(endpoint.host, endpoint.port));
}

if (master) {
  await check('redis_master_rejects_wrong_ca', () =>
    rejected(() => tls(master.host, master.port, badCa), certificateError),
  );
  await check('redis_master_rejects_wrong_hostname', () =>
    rejected(
      () => tls(master.host, master.port, cfg.redis.tlsCa, 'wrong-host.invalid'),
      certificateError,
    ),
  );
  await check('redis_master_plaintext_not_accepted', () => noPlainRedis(master.host, master.port));
}

await check('vault_real_transit_and_aes_compatibility_without_sql', async () => {
  const db = {
    execute() {
      throw new Error('cifra nova não pode usar SQL');
    },
  };
  const cipher = new HealthCipherService(db, cfg);
  const plaintext = 'movivo-security-synthetic-verification';
  const encrypted = await cipher.encryptHealth(plaintext);
  assert(encrypted.toString().startsWith('vault:v'));
  assert.equal(await cipher.decryptHealth(encrypted), plaintext);
  const local = new HealthCipherService(db, {
    pgcryptoKey: cfg.pgcryptoKey,
    healthCipher: { ...cfg.healthCipher, provider: 'LOCAL' },
  });
  const localEncrypted = await local.encryptHealth(plaintext);
  assert.equal(await cipher.decryptHealth(localEncrypted), plaintext);
  const derived = new HealthCipherService(db, { pgcryptoKey: cfg.pgcryptoKey });
  assert.equal(await cipher.decryptHealth(await derived.encryptHealth(plaintext)), plaintext);
});

await check('vault_api_token_has_no_key_admin_access', async () => {
  const response = await https(
    `${cfg.healthCipher.vaultAddr}/v1/transit/keys/${cfg.healthCipher.vaultKey}`,
    {
      headers: { 'X-Vault-Token': cfg.healthCipher.vaultToken },
    },
  );
  assert.equal(response.status, 403); // GET somente leitura; nunca tentar rotate/admin write
});
await check('vault_api_token_is_periodic', async () => {
  const response = await https(`${cfg.healthCipher.vaultAddr}/v1/auth/token/lookup-self`, {
    headers: { 'X-Vault-Token': cfg.healthCipher.vaultToken },
  });
  assert.equal(response.status, 200);
  const data = JSON.parse(response.body).data;
  assert(!data.policies.includes('root'));
  assert.equal(data.period, 86400);
  assert(data.ttl > 0);
});
await check('vault_rejects_wrong_ca', () =>
  rejected(() => https(cfg.healthCipher.vaultAddr, { ca: badCa }), certificateError),
);
await check('vault_rejects_wrong_hostname', () =>
  rejected(
    () => https(cfg.healthCipher.vaultAddr, { servername: 'wrong-host.invalid' }),
    certificateError,
  ),
);

await check('legacy_all_cipher_columns_decrypt_readonly', () => {
  const output = execFileSync(
    process.execPath,
    ['dist/scripts/rotate-health-cipher.js', '--dry-run'],
    { encoding: 'utf8', timeout: 30000 },
  );
  const rows = output
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(rows.length, 7);
  assert(rows.every((row) => row.mode === 'dry-run' && row.updated === 0 && row.conflicts === 0));
  return { verifiedValues: rows.reduce((total, row) => total + row.verified, 0) };
});

await check('api_https_and_bff_web_to_api', async () => {
  const api = await https('https://api:3443/api/v1/health');
  assert.equal(api.status, 200);
  assert(api.authorized);
  // Arquivo inexistente: só GET; o BFF precisa chegar à API para obter esse 404.
  const bff = await https(
    'https://web:3444/api/dashboard/account/avatar/00000000-0000-4000-8000-000000000000.png',
  );
  assert.equal(bff.status, 404);
  assert(bff.authorized);
});
await check('api_http_network_not_available', () =>
  rejected(
    () => fetch('http://api:3001/api/v1/health', { signal: AbortSignal.timeout(3000) }),
    (error) => error.cause?.code === 'ECONNREFUSED',
  ),
);
await check('evolution_https_readonly', async () => {
  assert.equal(new URL(cfg.evolution.baseUrl).protocol, 'https:');
  const response = await https(`${cfg.evolution.baseUrl}/instance/fetchInstances`, {
    headers: { apikey: cfg.evolution.apiKey },
  });
  assert.equal(response.status, 200);
  assert(response.authorized);
});

for (const result of results) process.stdout.write(`${JSON.stringify(result)}\n`);
process.stdout.write(
  `${JSON.stringify({ passed: results.filter((r) => r.status === 'passed').length, failed: results.filter((r) => r.status === 'failed').length, mutation: false })}\n`,
);

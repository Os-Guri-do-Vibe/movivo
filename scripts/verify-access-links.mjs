// Executar após build API, exclusivamente contra PostgreSQL DESCARTÁVEL.
// SECURITY_TEST_DATABASE_URL deve apontar para um banco movivo_security_test_*.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const apiRoot =
  process.env.MOVIVO_API_ROOT ?? fileURLToPath(new URL('../apps/api/', import.meta.url));
const url = process.env.SECURITY_TEST_DATABASE_URL;
if (!url || !/^movivo_security_test_[a-z0-9_]+$/.test(new URL(url).pathname.slice(1))) {
  throw new Error('Exige banco de teste descartável movivo_security_test_*; nunca produção.');
}
const require = createRequire(path.join(apiRoot, 'package.json'));
require('reflect-metadata');
const postgres = require('postgres');
const { drizzle } = require('drizzle-orm/postgres-js');
const { TenantDatabase } = require(
  path.join(apiRoot, 'dist/core/database/tenant-database.service.js'),
);
const { AccessLinkService } = require(
  path.join(apiRoot, 'dist/core/database/access-link.service.js'),
);
const { HealthCipherService } = require(
  path.join(apiRoot, 'dist/core/database/health-cipher.service.js'),
);
const { ShortLinkService } = require(
  path.join(apiRoot, 'dist/modules/short-link/short-link.service.js'),
);
const { buildRlsPoliciesSql } = require(
  path.join(apiRoot, 'dist/core/database/security-policies.js'),
);
const admin = postgres(url, { max: 1, onnotice: () => undefined });
let app;
try {
  await admin.unsafe(
    'CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE TABLE users (id uuid PRIMARY KEY, anonymized_at timestamptz)',
  );
  await admin.unsafe(
    readFileSync(path.join(apiRoot, 'drizzle/0065_daffy_miss_america.sql'), 'utf8'),
  );
  await admin.unsafe(readFileSync(path.join(apiRoot, 'drizzle/0052_shiny_the_twelve.sql'), 'utf8'));
  await admin.unsafe(readFileSync(path.join(apiRoot, 'drizzle/0066_lively_marauders.sql'), 'utf8'));
  const password = randomBytes(32).toString('hex');
  await admin.unsafe(
    `CREATE ROLE security_test_app LOGIN PASSWORD '${password}' NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO security_test_app; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO security_test_app`,
  );
  const policy = buildRlsPoliciesSql()
    .split(';')
    .filter((statement) => statement.includes('"access_link_tokens"'))
    .join(';');
  await admin.unsafe(policy);
  const [{ enabled, forced }] =
    await admin`SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE relname='access_link_tokens'`;
  assert.ok(enabled && forced);
  const users = [randomUUID(), randomUUID()];
  for (const user of users) await admin`INSERT INTO users(id) VALUES (${user})`;
  const appUrl = new URL(url);
  appUrl.username = 'security_test_app';
  appUrl.password = password;
  app = postgres(appUrl.toString(), { prepare: false, max: 1, onnotice: () => undefined });
  const db = drizzle(app);
  const tenant = new TenantDatabase(db);
  const links = new AccessLinkService(tenant);
  const now = new Date();
  const first = await links.issue('CHECKOUT', users[0], users[0], 3600000, now);
  assert.equal((await links.verify(first.token, 'CHECKOUT', now)).userId, users[0]);
  assert.equal(await links.verify(first.token, 'PROTOCOL', now), null);
  assert.equal(await links.verify(first.token, 'CHECKOUT', first.expiresAt), null);
  assert.equal(await links.verify(users[0], 'SUBSCRIPTION_PORTAL'), null);
  const [{ token_hash }] =
    await admin`SELECT token_hash FROM access_link_tokens WHERE user_id=${users[0]}`;
  assert.notEqual(token_hash, first.token);
  const second = await links.issue('CHECKOUT', users[0], users[0], 3600000, now);
  assert.equal(await links.verify(first.token, 'CHECKOUT', now), null);
  assert.ok(await links.verify(second.token, 'CHECKOUT', now));
  await links.revoke(second.token);
  assert.equal(await links.verify(second.token, 'CHECKOUT', now), null);
  const third = await links.issue('PROTOCOL', users[0], randomUUID(), 3600000, now);
  const other = await links.issue('SUBSCRIPTION_PORTAL', users[1], users[1], 3600000, now);
  await links.revokeForUser(users[0]);
  assert.equal(await links.verify(third.token, 'PROTOCOL', now), null);
  assert.ok(await links.verify(other.token, 'SUBSCRIPTION_PORTAL', now));
  await tenant.runAsUser(users[0], 'USER', async (tx) => {
    const rows = await tx.execute(
      require('drizzle-orm').sql`SELECT user_id FROM access_link_tokens`,
    );
    assert.ok(rows.every((row) => row.user_id === users[0]));
  });
  await admin`UPDATE users SET anonymized_at=now() WHERE id=${users[1]}`;
  assert.equal(await links.verify(other.token, 'SUBSCRIPTION_PORTAL'), null);
  const cipher = new HealthCipherService(db, { pgcryptoKey: randomBytes(32).toString('hex') });
  const aliases = new ShortLinkService(tenant, cipher);
  const target = `https://movivo.test/protocolo/${third.token}`;
  const code = await aliases.create(target, new Date(Date.now() + 3600000));
  assert.equal(code.length, 24);
  assert.equal(await aliases.resolve(code), target);
  const [{ target_url }] =
    await admin`SELECT target_url FROM short_links WHERE code=${require('node:crypto').createHash('sha256').update(code).digest('hex')}`;
  assert.ok(target_url.startsWith('pgp:v1:') && !target_url.includes(third.token));
  console.log(
    'access-links: banco real, RLS, hash-only, escopo, expiração, renovação, revogação e aliases cifrados aprovados',
  );
} finally {
  if (app) await app.end();
  await admin.end();
}

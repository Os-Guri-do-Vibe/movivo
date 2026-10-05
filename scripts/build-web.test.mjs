import console from 'node:console';
import assert from 'node:assert/strict';
import { buildEnv, checkEnvFile } from './build-web.mjs';

const secret = 'canary-only-for-security-test';
const env = buildEnv({
  PATH: '/bin',
  OPENAI_API_KEY: secret,
  AUTH_SECRET: secret,
  JWT_PRIVATE_KEY_FILE: '/run/secrets/jwt_private_key',
  NODE_AUTH_TOKEN: secret,
  NEXT_PUBLIC_SITE_URL: 'https://movivo.com.br',
});
assert.equal(env.NEXT_PUBLIC_SITE_URL, 'https://movivo.com.br');
assert.equal(env.NODE_ENV, 'production');
assert.ok(!JSON.stringify(env).includes(secret));
assert.ok(!('JWT_PRIVATE_KEY_FILE' in env));
for (const key of [
  'OPENAI_API_KEY',
  'AUTH_SECRET',
  'JWT_PRIVATE_KEY_FILE',
  'NEXT_PUBLIC_UNKNOWN_KEY',
]) {
  assert.throws(() => checkEnvFile(`${key}=${secret}`, '.env.local'), /Build bloqueado/);
}
assert.throws(() => buildEnv({ NEXT_PUBLIC_POSTHOG_KEY: 'phx_private' }), /Build bloqueado/);
assert.throws(
  () => checkEnvFile('NEXT_PUBLIC_SITE_URL=https://user:password@example.org', '.env'),
  /Build bloqueado/,
);
assert.doesNotThrow(() =>
  checkEnvFile(
    '# público\nNEXT_PUBLIC_SITE_URL=http://localhost:3000\nMOVIVO_API_URL=http://api:3001/api/v1',
    '.env.local',
  ),
);
console.log('build-web: isolamento e bloqueio de secrets validados');

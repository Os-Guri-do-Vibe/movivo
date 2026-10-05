import process from 'node:process';
import console from 'node:console';
import { URL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const web = fileURLToPath(new URL('../apps/web/', import.meta.url));
const publicKeys = [
  'NEXT_PUBLIC_APP_ENV',
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_API_URL',
  'NEXT_PUBLIC_ADMIN_URL',
  'NEXT_PUBLIC_POSTHOG_KEY',
  'NEXT_PUBLIC_POSTHOG_HOST',
];
const fileKeys = new Set([...publicKeys, 'NODE_ENV', 'MOVIVO_API_URL']);

// Next carrega .env mesmo com process.env vazio. Rejeitar antes de iniciar o compilador.
export function checkEnvFile(content, name) {
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = line.match(/^\s*(?:export\s+)?([\w]+)\s*=(.*)$/);
    if (!match || !fileKeys.has(match[1])) {
      throw new Error(
        `Build bloqueado: variável privada ou sintaxe inválida em ${name}. Use runtime server-side.`,
      );
    }
    checkPublicValue(match[1], match[2].trim().replace(/^['"]|['"]$/g, ''));
  }
}

function checkPublicValue(key, value) {
  if (key === 'NEXT_PUBLIC_POSTHOG_KEY' && value && !/^phc_[\w]+$/.test(value)) {
    throw new Error(
      'Build bloqueado: NEXT_PUBLIC_POSTHOG_KEY deve ser uma project key pública phc_.',
    );
  }
  if ((key.endsWith('_URL') || key.endsWith('_HOST')) && value) {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error(
        `Build bloqueado: ${key} deve ser uma URL pública sem credenciais, query ou fragmento.`,
      );
    }
  }
}

export function buildEnv(source) {
  // Lista fechada: nenhuma credencial (incluindo *_FILE, tokens de npm/CI/cloud) é herdada.
  const keys = [
    ...publicKeys,
    'PATH',
    'HOME',
    'TMPDIR',
    'TEMP',
    'TMP',
    'SystemRoot',
    'WINDIR',
    'CI',
    'NEXT_OUTPUT_STANDALONE',
    'NEXT_TELEMETRY_DISABLED',
    'TZ',
  ];
  const env = { NODE_ENV: 'production' };
  for (const key of keys) {
    if (source[key] !== undefined) {
      if (publicKeys.includes(key)) checkPublicValue(key, source[key]);
      env[key] = source[key];
    }
  }
  return env;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const env = buildEnv(process.env);
    for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
      const file = path.join(web, name);
      if (existsSync(file)) checkEnvFile(readFileSync(file, 'utf8'), name);
    }
    const require = createRequire(path.join(web, 'package.json'));
    const result = spawnSync(
      process.execPath,
      [require.resolve('next/dist/bin/next'), 'build', '--webpack'],
      {
        cwd: web,
        env,
        stdio: 'inherit',
      },
    );
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  } catch (error) {
    // Não serializar valores do ambiente nem o erro do parser de URL (contém a entrada).
    console.error(
      error instanceof TypeError ? 'Build bloqueado: URL pública inválida.' : error.message,
    );
    process.exitCode = 1;
  }
}

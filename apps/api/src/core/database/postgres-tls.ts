import { checkServerIdentity, type ConnectionOptions } from 'node:tls';
import type { RawEnv } from '../config/resolve-file-secrets';

/** TLS verificado; sem `require`/`prefer` (postgres.js desliga validação nesses modos). */
export function postgresTls(
  host: string,
  enabled: boolean,
  ca?: string,
): false | ConnectionOptions {
  if (!enabled) {
    if (ca) throw new Error('CA configurada exige TLS habilitado.');
    return false;
  }
  if (!host) throw new Error('TLS PostgreSQL exige hostname configurado.');
  return {
    rejectUnauthorized: true,
    ca,
    // postgres.js reutiliza socket e não fornece host para IP; conferir o destino real.
    checkServerIdentity: (_hostname, certificate) => checkServerIdentity(host, certificate),
  };
}

/** Scripts de manutenção usam loadEnv sem schema completo da API. Não ignorar flags inválidas. */
export function migrationPostgresTls(
  env: RawEnv,
  host: string | undefined,
): false | ConnectionOptions {
  const flag = (env.MIGRATION_DATABASE_SSL ?? env.DATABASE_SSL ?? 'false').trim().toLowerCase();
  const enabled = ['true', '1', 'yes', 'y', 'on'].includes(flag);
  if (!enabled && !['false', '0', 'no', 'n', 'off'].includes(flag)) {
    throw new Error('MIGRATION_DATABASE_SSL deve ser booleano.');
  }
  return postgresTls(host ?? '', enabled, env.MIGRATION_DATABASE_SSL_CA ?? env.DATABASE_SSL_CA);
}

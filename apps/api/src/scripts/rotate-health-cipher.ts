/**
 * Manutenção explícita, sem AppModule/workers. Default: somente decifra e verifica.
 * --apply --actor=<UUID staff> recifra com a chave ativa; preserve backup + chaves antigas.
 * Compare-and-swap evita sobrescrever alteração concorrente. Reexecutável após interrupção.
 */
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { AppConfigService } from '../core/config/app-config.service';
import { buildAppConfig } from '../core/config/config.module';
import { createPostgresClient } from '../core/database/database.module';
import { HealthCipherService } from '../core/database/health-cipher.service';
import { TenantDatabase } from '../core/database/tenant-database.service';

const targets = [
  ['anamnesis_sessions', 'data_block_2', 'id'],
  ['protocol_renewal_sessions', 'data_block_3', 'id'],
  ['checkins', 'notes_cipher', 'id'],
  ['workout_sessions', 'feedback_cipher', 'id'],
  ['protocols', 'mesocycle_notes_cipher', 'id'],
  ['staff', 'mfa_secret_cipher', 'id'],
  ['short_links', 'target_url', 'code'],
  ['conversations', 'content', 'id'],
  ['coaching_sessions', 'summary', 'id'],
] as const;

/** CAS + auditoria na mesma transação. Falha de auditoria aborta a escrita. */
export async function writeRotatedCipher(
  tenant: TenantDatabase,
  input: {
    tableName: string;
    columnName: string;
    idName: string;
    rowId: string;
    original: Buffer | string;
    replacement: Buffer | string;
    actor: string;
    runId: string;
    provider: 'LOCAL' | 'VAULT';
    keyId: string;
    vaultKey: string;
    vaultVersion: string | null;
  },
): Promise<number> {
  if (
    !targets.some(
      ([t, c, id]) => t === input.tableName && c === input.columnName && id === input.idName,
    )
  ) {
    throw new Error('Alvo de rotação inválido.');
  }
  return tenant.runAsSystem(async (tx) => {
    const result = await tx.execute(sql`UPDATE ${sql.identifier(input.tableName)}
      SET ${sql.identifier(input.columnName)} = ${input.replacement}
      WHERE ${sql.identifier(input.idName)}::text = ${input.rowId}
        AND ${sql.identifier(input.columnName)} = ${input.original}
      RETURNING ${sql.identifier(input.idName)}`);
    if (result.length) {
      const metadata = {
        table: input.tableName,
        column: input.columnName,
        provider: input.provider,
        ...(input.provider === 'VAULT'
          ? { vaultKey: input.vaultKey, vaultVersion: input.vaultVersion }
          : { keyId: input.keyId }),
      };
      await tx.execute(sql`INSERT INTO audit_logs (actor_id, user_id, action, entity_type, entity_id, changes)
        VALUES (${input.actor}::uuid, ${input.actor}::uuid, 'HEALTH_CIPHER_REENCRYPTED', 'cipher_rotation',
          ${input.runId}::uuid, ${JSON.stringify(metadata)}::jsonb)`);
    }
    return result.length;
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply' && arg !== '--dry-run' && !arg.startsWith('--actor='))) {
    throw new Error('Use --dry-run ou --apply --actor=<UUID staff>.');
  }
  const apply = args.includes('--apply');
  if (apply && args.includes('--dry-run')) throw new Error('Escolha apenas um modo.');
  const actor = args.find((arg) => arg.startsWith('--actor='))?.slice(8);
  if (
    apply &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actor ?? '')
  ) {
    throw new Error('--apply exige --actor=<UUID staff>.');
  }
  const config = new AppConfigService(buildAppConfig());
  const client = createPostgresClient(config);
  const db = drizzle(client);
  const tenant = new TenantDatabase(db);
  const cipher = new HealthCipherService(db, config);
  const runId = randomUUID();
  try {
    if (apply) {
      const rows = await tenant.runAsSystem((tx) =>
        tx.execute(
          sql`SELECT id FROM staff WHERE id = ${actor}::uuid AND role = 'ADMIN' AND status = 'ACTIVE'`,
        ),
      );
      if (!rows.length) throw new Error('Operador deve ser ADMIN ativo.');
    }
    for (const [tableName, columnName, idName] of targets) {
      const textColumn = tableName === 'conversations' || tableName === 'coaching_sessions';
      const table = sql.identifier(tableName);
      const column = sql.identifier(columnName);
      const id = sql.identifier(idName);
      let cursor = '';
      let verified = 0;
      let updated = 0;
      let conflicts = 0;
      let pendingPlaintext = 0;
      for (;;) {
        const rows = (await tenant.runAsSystem((tx) =>
          tx.execute(sql`
          SELECT ${id}::text AS id, ${column} AS cipher FROM ${table}
          WHERE ${column} IS NOT NULL AND ${id}::text > ${cursor}
          ORDER BY ${id}::text LIMIT 100`),
        )) as unknown as Array<{ id: string; cipher: Buffer | string }>;
        if (!rows.length) break;
        for (const row of rows) {
          const original = row.cipher;
          if (textColumn && typeof original !== 'string') throw new Error('Texto inválido.');
          if (textColumn && !(original as string).startsWith('movivo:health:text:v1:'))
            pendingPlaintext++;
          if (!textColumn && typeof original === 'string' && !original.startsWith('pgp:v1:')) {
            throw new Error('Alias sem cifra; execute a migração de schema antes da rotação.');
          }
          const plaintext = textColumn
            ? await cipher.decryptText(original as string)
            : await cipher.decryptHealth(
                typeof original === 'string' ? Buffer.from(original.slice(7), 'base64') : original,
              );
          verified++;
          if (apply) {
            const next = textColumn
              ? await cipher.encryptText(plaintext)
              : await cipher.encryptHealth(plaintext);
            const roundtrip = textColumn
              ? await cipher.decryptText(next as string)
              : await cipher.decryptHealth(next as Buffer);
            if (roundtrip !== plaintext)
              throw new Error('Round-trip falhou.');
            const replacement = textColumn
              ? next
              : typeof original === 'string'
                ? `pgp:v1:${(next as Buffer).toString('base64')}`
                : next;
            const envelope = textColumn
              ? Buffer.from((next as string).slice('movivo:health:text:v1:'.length), 'base64')
              : (next as Buffer);
            const changed = await writeRotatedCipher(tenant, {
              tableName,
              columnName,
              idName,
              rowId: row.id,
              original,
              replacement,
              actor: actor ?? '',
              runId,
              provider: config.healthCipher.provider,
              keyId: config.healthCipher.keyId,
              vaultKey: config.healthCipher.vaultKey,
              vaultVersion: /^vault:v(\d+):/.exec(envelope.toString())?.[1] ?? null,
            });
            if (changed) updated++;
            else conflicts++;
          }
        }
        cursor = rows[rows.length - 1]?.id ?? cursor;
      }
      process.stdout.write(
        JSON.stringify({
          runId,
          mode: apply ? 'apply' : 'dry-run',
          table: tableName,
          verified,
          updated,
          conflicts,
          ...(textColumn ? { pendingPlaintext } : {}),
        }) + '\n',
      );
      if (conflicts)
        throw new Error('Alterações concorrentes detectadas; reexecute antes de retirar chaves.');
    }
  } finally {
    await client.end();
  }
}

if (require.main === module)
  void main().catch(() => {
    // Não imprimir causas do driver: podem carregar query, ciphertext e chave legada.
    console.error(
      'Rotação/verificação interrompida. Preserve todas as chaves e confira configuração, acesso e integridade antes de reexecutar.',
    );
    process.exitCode = 1;
  });

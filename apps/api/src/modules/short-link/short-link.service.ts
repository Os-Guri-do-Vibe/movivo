/** Aliases de credenciais: destino cifrado em repouso; código aleatório de 24 caracteres. */
import { Injectable } from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import { HealthCipherService } from '../../core/database/health-cipher.service';
import { and, eq, gt } from 'drizzle-orm';

import { shortLinks } from '../../core/database/schema';
import { TenantDatabase } from '../../core/database/tenant-database.service';

/** Sem 0/O/1/l/I — evita confusão visual quando alguém precisa digitar o código à mão. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const CODE_LENGTH = 24;
const MAX_CREATE_ATTEMPTS = 5;

const hashCode = (code: string) => createHash('sha256').update(code).digest('hex');

function randomCode(): string {
  return Array.from(
    { length: CODE_LENGTH },
    () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
  ).join('');
}

@Injectable()
export class ShortLinkService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
  ) {}

  /** Cria o alias e devolve só o código — quem chama monta a URL amigável final. */
  async create(targetUrl: string, expiresAt: Date): Promise<string> {
    const encryptedTarget = `pgp:v1:${(await this.cipher.encryptHealth(targetUrl)).toString('base64')}`;
    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
      const code = randomCode();
      const inserted = await this.db.runAsSystem((tx) =>
        tx
          .insert(shortLinks)
          .values({ code: hashCode(code), targetUrl: encryptedTarget, expiresAt })
          .onConflictDoNothing({ target: shortLinks.code })
          .returning({ code: shortLinks.code }),
      );
      if (inserted[0]) return code;
    }
    throw new Error(
      `short-link: falha ao gerar código único após ${MAX_CREATE_ATTEMPTS} tentativas`,
    );
  }

  /** `null` = código inexistente ou expirado — o controller trata os dois como 410. */
  async resolve(code: string): Promise<string | null> {
    return this.lookup(code, true);
  }

  /** Destino do código mesmo vencido: só para reenviar um link novo ao dono (nunca redireciona). */
  async resolveForRenewal(code: string): Promise<string | null> {
    return this.lookup(code, false);
  }

  private async lookup(code: string, onlyValid: boolean): Promise<string | null> {
    const [row] = await this.db.runAsSystem((tx) =>
      tx
        .select({ targetUrl: shortLinks.targetUrl })
        .from(shortLinks)
        .where(
          onlyValid
            ? and(eq(shortLinks.code, hashCode(code)), gt(shortLinks.expiresAt, new Date()))
            : eq(shortLinks.code, hashCode(code)),
        )
        .limit(1),
    );
    if (!row?.targetUrl.startsWith('pgp:v1:')) return null;
    return this.cipher.decryptHealth(Buffer.from(row.targetUrl.slice(7), 'base64'));
  }
}

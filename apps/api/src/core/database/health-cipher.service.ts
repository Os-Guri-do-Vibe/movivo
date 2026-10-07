/**
 * Cifra de aplicação: novas escritas nunca enviam plaintext/chave ao PostgreSQL.
 * AES-256-GCM local com ID autenticado ou Vault Transit (chave não sai do Vault).
 * Leitura de pgcrypto antigo preservada exclusivamente para migração/restore.
 */
import { request as httpsRequest } from 'node:https';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { AppConfigService } from '../config';
import { DRIZZLE } from './database.constants';
import { type DrizzleClient } from './database.module';

const PREFIX = 'movivo:health:v1:';
const TEXT_PREFIX = 'movivo:health:text:v1:';
const LEGACY_KEY_ID = 'legacy-derived';

@Injectable()
export class HealthCipherService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleClient,
    private readonly config: AppConfigService,
  ) {}

  private localKey(id: string): Buffer {
    // ponytail: compatibilidade MVP usa o segredo aleatório existente; migrar para
    // keyring independente ou Vault antes de retirar a chave dos backups legados.
    if (id === LEGACY_KEY_ID) {
      return createHash('sha256').update(this.config.pgcryptoKey).digest();
    }
    const encoded = this.config.healthCipher?.keyring?.[id];
    if (encoded) {
      const key = Buffer.from(encoded, 'base64');
      if (key.length !== 32) throw new Error('Chave inválida');
      return key;
    }
    throw new Error('Chave indisponível');
  }

  /** CA privada só é confiada neste endpoint, sem ampliar a trust store de outros provedores. */
  private async vaultResponse(url: string, body: string): Promise<Response> {
    const cfg = this.config.healthCipher;
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Vault-Token': cfg.vaultToken ?? '' },
      signal: AbortSignal.timeout(cfg.vaultTimeoutMs),
    };
    if (!cfg.vaultCa) return fetch(url, { ...options, body, redirect: 'error' });
    return new Promise((resolve, reject) => {
      const request = httpsRequest(
        url,
        { ...options, ca: cfg.vaultCa, rejectUnauthorized: true },
        (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            reject(new Error('Vault indisponível'));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 2 * 1024 * 1024) {
              response.destroy(new Error('Resposta Vault excedeu limite'));
              return;
            }
            chunks.push(chunk);
          });
          response.on('error', reject);
          response.on('aborted', () => reject(new Error('Resposta Vault interrompida')));
          response.on('end', () =>
            resolve(
              new Response(Buffer.concat(chunks).toString('utf8'), {
                status: response.statusCode ?? 502,
              }),
            ),
          );
        },
      );
      request.on('error', reject);
      request.end(body);
    });
  }

  /** Erros externos e causas nunca atravessam este boundary (podem conter segredos). */
  private async transit(operation: 'encrypt' | 'decrypt', value: string): Promise<string> {
    const cfg = this.config.healthCipher;
    if (!cfg?.vaultAddr || !cfg.vaultToken) throw new Error('Vault indisponível');
    const response = await this.vaultResponse(
      `${cfg.vaultAddr.replace(/\/$/, '')}/v1/transit/${operation}/${cfg.vaultKey}`,
      JSON.stringify(operation === 'encrypt' ? { plaintext: value } : { ciphertext: value }),
    );
    if (!response.ok) throw new Error('Vault indisponível');
    const payload = (await response.json()) as {
      data?: { ciphertext?: unknown; plaintext?: unknown };
    };
    const result = payload.data?.[operation === 'encrypt' ? 'ciphertext' : 'plaintext'];
    if (
      typeof result !== 'string' ||
      (operation === 'encrypt' && !/^vault:v[1-9]\d*:/.test(result)) ||
      (operation === 'decrypt' &&
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(result))
    ) {
      throw new Error('Resposta Vault inválida');
    }
    return result;
  }

  async encryptHealth(plaintext: string): Promise<Buffer> {
    try {
      if (this.config.healthCipher?.provider === 'VAULT') {
        return Buffer.from(
          await this.transit('encrypt', Buffer.from(plaintext).toString('base64')),
        );
      }
      const id = this.config.healthCipher?.keyId ?? LEGACY_KEY_ID;
      const header = `${PREFIX}${id}:`;
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.localKey(id), iv);
      cipher.setAAD(Buffer.from(header));
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return Buffer.concat([Buffer.from(header), iv, cipher.getAuthTag(), encrypted]);
    } catch {
      throw new Error('HealthCipherService: falha ao cifrar.');
    }
  }

  /** Envelope ASCII para colunas TEXT existentes, sem mudar contratos ou índices. */
  async encryptText(plaintext: string): Promise<string> {
    return TEXT_PREFIX + (await this.encryptHealth(plaintext)).toString('base64');
  }

  /** Plaintext anterior à migração continua legível até a recifra ser verificada. */
  async decryptText(value: string): Promise<string> {
    if (!value.startsWith(TEXT_PREFIX)) return value;
    const encoded = value.slice(TEXT_PREFIX.length);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
      throw new Error('HealthCipherService: envelope de texto inválido.');
    }
    return this.decryptHealth(Buffer.from(encoded, 'base64'));
  }

  async decryptHealth(ciphertext: Buffer): Promise<string> {
    try {
      if (ciphertext.subarray(0, 6).toString() === 'vault:') {
        const value = await this.transit('decrypt', ciphertext.toString());
        return Buffer.from(value, 'base64').toString('utf8');
      }
      if (ciphertext.subarray(0, PREFIX.length).toString() === PREFIX) {
        const separator = ciphertext.indexOf(58, PREFIX.length);
        if (separator < 0 || separator > PREFIX.length + 80) throw new Error('Envelope inválido');
        const id = ciphertext.subarray(PREFIX.length, separator).toString();
        if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('Envelope inválido');
        const offset = separator + 1;
        if (ciphertext.length < offset + 28) throw new Error('Envelope inválido');
        const decipher = createDecipheriv(
          'aes-256-gcm',
          this.localKey(id),
          ciphertext.subarray(offset, offset + 12),
        );
        decipher.setAAD(ciphertext.subarray(0, offset));
        decipher.setAuthTag(ciphertext.subarray(offset + 12, offset + 28));
        return Buffer.concat([
          decipher.update(ciphertext.subarray(offset + 28)),
          decipher.final(),
        ]).toString('utf8');
      }
      // pgcrypto OpenPGP inicia com packet header de bit alto. Envelope corrompido
      // ou formato futuro não pode cair silenciosamente na leitura legada.
      if (!((ciphertext[0] ?? 0) & 0x80)) throw new Error('Formato inválido');
      const rows = (await this.db.execute(
        sql`SELECT pgp_sym_decrypt(${ciphertext}::bytea, ${this.config.pgcryptoKey}) AS plaintext`,
      )) as unknown as Array<{ plaintext: string }>;
      if (typeof rows[0]?.plaintext !== 'string') throw new Error('Legado inválido');
      return rows[0].plaintext;
    } catch {
      throw new Error(
        'HealthCipherService: falha ao decifrar (chave indisponível ou dado corrompido).',
      );
    }
  }
}

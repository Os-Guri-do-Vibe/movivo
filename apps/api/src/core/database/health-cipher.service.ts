/**
 * `HealthCipherService` — cifra em repouso do dado de saúde (US-1.1 / TASK-1.1.3 — Sato §7.3).
 *
 * Cifra/decifra com `pgcrypto` (`pgp_sym_encrypt`/`pgp_sym_decrypt`, AES + OpenPGP)
 * usando a chave simétrica carregada de `PGCRYPTO_KEY_FILE` (contrato `*_FILE` da
 * Sprint 0). A chave:
 *  - **nunca** é hardcoded nem persistida no banco (Sato §7.3);
 *  - **nunca** aparece em log — trafega só como *bind parameter* (o driver não loga
 *    valores; `onnotice` está desligado no cliente) e o `AppConfigService` a marca como
 *    segredo (`redactedSnapshot`);
 *  - é aplicada por `text` de passphrase do OpenPGP (o pgcrypto deriva a chave da cifra).
 *
 * O ciphertext é `bytea` (Buffer no Node). Um `SELECT` bruto da coluna retorna bytes
 * opacos, nunca o plaintext — é o critério de aceite do round-trip.
 *
 * A **aplicação** desta cifra em `anamnesis_sessions.data_block_2` acontece na US-1.3;
 * aqui entregamos o helper + o round-trip provado.
 *
 * ## Rotação anual da chave (runbook — Sato §9.3, Fase B)
 * A chave é rotacionada anualmente. O re-encrypt em massa (Fase B) não é implementado
 * agora; o procedimento é: (1) gerar nova chave como novo Docker Secret com sufixo de
 * versão; (2) decifrar com a chave N-1 e recifrar com a N num job auditável de
 * manutenção; (3) invalidar a chave antiga após a varredura completa. Enquanto o
 * re-encrypt não existe, trocar a chave torna o dado existente ilegível — por isso a
 * rotação é uma operação planejada, não automática.
 */
import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { AppConfigService } from '../config';
import { DRIZZLE } from './database.constants';
import { type DrizzleClient } from './database.module';

@Injectable()
export class HealthCipherService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleClient,
    private readonly config: AppConfigService,
  ) {}

  private get key(): string {
    return this.config.pgcryptoKey;
  }

  /**
   * Cifra um texto (tipicamente `JSON.stringify` do bloco de saúde) e devolve o
   * ciphertext `bytea`. Determinístico? Não — o OpenPGP adiciona sal/IV, então dois
   * `encryptHealth` do mesmo valor produzem ciphertexts distintos (propriedade
   * desejável; impede correlação por igualdade de ciphertext).
   */
  async encryptHealth(plaintext: string): Promise<Buffer> {
    const rows = (await this.db.execute(
      sql`SELECT pgp_sym_encrypt(${plaintext}, ${this.key}) AS ciphertext`,
    )) as unknown as Array<{ ciphertext: Buffer }>;
    const ciphertext = rows[0]?.ciphertext;
    if (!ciphertext) throw new Error('HealthCipherService: falha ao cifrar (sem retorno).');
    return ciphertext;
  }

  /** Decifra um ciphertext `bytea` produzido por {@link encryptHealth}. */
  async decryptHealth(ciphertext: Buffer): Promise<string> {
    const rows = (await this.db.execute(
      sql`SELECT pgp_sym_decrypt(${ciphertext}::bytea, ${this.key}) AS plaintext`,
    )) as unknown as Array<{ plaintext: string }>;
    const plaintext = rows[0]?.plaintext;
    if (plaintext === undefined) {
      throw new Error(
        'HealthCipherService: falha ao decifrar (chave incorreta ou dado corrompido).',
      );
    }
    return plaintext;
  }
}

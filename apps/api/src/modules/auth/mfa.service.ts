/**
 * `MfaService` — segundo fator (TOTP) das contas internas (OWASP ASVS 2.8, NIST 800-63B AAL2).
 *
 * As contas do Control Center abrem dado de saúde de TODOS os titulares; senha sozinha é o
 * elo mais fraco (reuso, phishing, vazamento). Aqui o login vira dois passos:
 *
 *  1. senha OK → o `AuthService` NÃO emite sessão: cria um **desafio** (`createChallenge`),
 *     token opaco de 256 bits, de uso único, com TTL de 5 min, guardado no Redis só como hash.
 *  2. o desafio é resolvido com um código TOTP (`verifyLogin`) ou, para quem ainda não tem MFA
 *     numa instalação que o exige, por inscrição (`beginSetup` + `enable`). Só então sai sessão.
 *
 * Defesas:
 *  - **Anti-replay**: o passo TOTP aceito é gravado (`mfa_last_step`) com UPDATE condicional
 *    atômico; um código só vale uma vez, mesmo sob requisições concorrentes.
 *  - **Força bruta**: 5 erros queimam o desafio (volta à senha) e 10 erros em 15 min travam a
 *    conta para novos códigos (429) — 6 dígitos sem isso cairiam em ~1M tentativas.
 *  - **Segredo cifrado** (`pgp_sym_encrypt`, mesma chave do dado de saúde); códigos de
 *    recuperação guardados só como SHA-256 e consumidos no uso.
 *  - O desafio carrega uma impressão da senha: trocar a senha invalida desafios pendentes.
 */
import { createHash, randomBytes } from 'node:crypto';

import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { Redis } from 'ioredis';

import { AppConfigService } from '../../core/config';
import { HealthCipherService, TenantDatabase, type TenantRole } from '../../core/database';
import { staff } from '../../core/database/schema';
import { REDIS_CLIENT } from '../../core/redis/redis.constants';
import { REDIS_KEY_BUILDER, RedisKeyBuilder } from '../../core/redis/redis-key.util';
import { AUTH_AUDIT_ACTIONS, AuthAuditService, type AccessMeta } from './auth-audit.service';
import { buildOtpauthUri, generateTotpSecret, verifyTotp } from './totp';

export type MfaMode = 'VERIFY' | 'SETUP';

/** Identidade já autenticada por senha + 2º fator: o `AuthService` converte em sessão. */
export interface MfaIdentity {
  userId: string;
  role: TenantRole;
  passwordHash: string;
  /** Como o 2º fator foi provado (vai para a trilha de auditoria). */
  method: 'totp' | 'recovery' | 'enrollment';
}

interface ChallengeState {
  staffId: string;
  mode: MfaMode;
  /** SHA-256 do `passwordHash` no momento do login: trocar a senha invalida o desafio. */
  passwordFingerprint: string;
  /** Segredo gerado na inscrição, ainda não confirmado (`SETUP`). */
  pendingSecret?: string;
}

export const MFA_CHALLENGE_TTL_SECONDS = 300;
const CHALLENGE_MAX_WRONG_CODES = 5;
const LOCK_THRESHOLD = 10;
const LOCK_WINDOW_SECONDS = 900;
const RECOVERY_CODE_COUNT = 10;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** `XXXXX-XXXXX`, sem caracteres ambíguos (0/O, 1/I). ~50 bits cada. */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(10);
  const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]);
  return `${chars.slice(0, 5).join('')}-${chars.slice(5).join('')}`;
}

/** Normaliza o que o usuário digitou: sem hífen/espaço, maiúsculo. */
export function normalizeRecoveryCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase();
}

export function looksLikeRecoveryCode(input: string): boolean {
  return /^[A-Z2-9]{10}$/.test(normalizeRecoveryCode(input));
}

export const hashRecoveryCode = (input: string) => sha256(normalizeRecoveryCode(input));

@Injectable()
export class MfaService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly cipher: HealthCipherService,
    private readonly config: AppConfigService,
    private readonly trail: AuthAuditService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
  ) {}

  /** `VERIFY` se já tem MFA; `SETUP` se a instalação exige e a conta ainda não tem; senão `null`. */
  modeFor(account: { mfaEnabledAt: Date | null }): MfaMode | null {
    if (account.mfaEnabledAt) return 'VERIFY';
    return this.config.mfa.required ? 'SETUP' : null;
  }

  async createChallenge(staffId: string, mode: MfaMode, passwordHash: string): Promise<string> {
    const token = randomBytes(32).toString('hex');
    const state: ChallengeState = {
      staffId,
      mode,
      passwordFingerprint: sha256(passwordHash),
    };
    await this.redis.set(
      this.challengeKey(token),
      JSON.stringify(state),
      'EX',
      MFA_CHALLENGE_TTL_SECONDS,
    );
    return token;
  }

  /** Inicia (ou repete, idempotente) a inscrição: devolve o segredo e a URI do QR. */
  async beginSetup(
    token: string,
  ): Promise<{ secret: string; otpauthUri: string; account: string }> {
    const state = await this.loadChallenge(token, 'SETUP');
    const [row] = await this.db.runAsSystem((tx) =>
      tx
        .select({ email: staff.email, mfaEnabledAt: staff.mfaEnabledAt })
        .from(staff)
        .where(eq(staff.id, state.staffId))
        .limit(1),
    );
    if (!row || row.mfaEnabledAt) throw this.expired();

    const secret = state.pendingSecret ?? generateTotpSecret();
    if (!state.pendingSecret) {
      await this.saveChallenge(token, { ...state, pendingSecret: secret });
    }
    return {
      secret,
      otpauthUri: buildOtpauthUri(this.config.mfa.issuer, row.email, secret),
      account: row.email,
    };
  }

  /** Resolve um desafio `VERIFY` com TOTP ou código de recuperação. */
  async verifyLogin(token: string, code: string, meta: AccessMeta = {}): Promise<MfaIdentity> {
    const state = await this.loadChallenge(token, 'VERIFY');
    await this.assertNotLocked(state.staffId);

    const [row] = await this.db.runAsSystem((tx) =>
      tx
        .select({
          role: staff.role,
          passwordHash: staff.passwordHash,
          secretCipher: staff.mfaSecretCipher,
          enabledAt: staff.mfaEnabledAt,
          lastStep: staff.mfaLastStep,
        })
        .from(staff)
        .where(eq(staff.id, state.staffId))
        .limit(1),
    );
    if (!row || !row.enabledAt || !row.secretCipher) throw this.expired();
    this.assertPasswordUnchanged(state, row.passwordHash);

    let method: MfaIdentity['method'] | null = null;
    if (looksLikeRecoveryCode(code)) {
      if (await this.consumeRecoveryCode(state.staffId, code)) {
        method = 'recovery';
        const remaining = await this.remainingRecoveryCodes(state.staffId);
        await this.trail.record(AUTH_AUDIT_ACTIONS.mfaRecoveryUsed, state.staffId, meta, {
          remaining,
        });
      }
    } else {
      const secret = await this.cipher.decryptHealth(row.secretCipher);
      const step = verifyTotp(secret, code, Date.now(), row.lastStep ?? null);
      if (step !== null && (await this.claimStep(state.staffId, step))) method = 'totp';
    }

    if (!method) {
      await this.registerFailure(token, state.staffId, meta);
      throw new UnauthorizedException('Código inválido ou expirado.');
    }
    await this.finish(token, state.staffId);
    return {
      userId: state.staffId,
      role: row.role,
      passwordHash: row.passwordHash,
      method,
    };
  }

  /** Confirma a inscrição com o 1º código, ativa o MFA e devolve os códigos de recuperação. */
  async enable(
    token: string,
    code: string,
    meta: AccessMeta = {},
  ): Promise<MfaIdentity & { recoveryCodes: string[] }> {
    const state = await this.loadChallenge(token, 'SETUP');
    if (!state.pendingSecret) throw this.expired();
    await this.assertNotLocked(state.staffId);

    const step = verifyTotp(state.pendingSecret, code, Date.now(), null);
    if (step === null) {
      await this.registerFailure(token, state.staffId, meta);
      throw new UnauthorizedException('Código inválido ou expirado.');
    }

    const secretCipher = await this.cipher.encryptHealth(state.pendingSecret);
    const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
    const hashes = recoveryCodes.map(hashRecoveryCode);

    const [row] = await this.db.runAsSystem((tx) =>
      tx
        .update(staff)
        .set({
          mfaSecretCipher: secretCipher,
          mfaEnabledAt: new Date(),
          mfaLastStep: step,
          mfaRecoveryHashes: hashes,
        })
        // `mfa_enabled_at IS NULL` + senha igual: duas inscrições concorrentes não se
        // sobrescrevem, e uma senha trocada no meio do caminho invalida a inscrição.
        .where(and(eq(staff.id, state.staffId), isNull(staff.mfaEnabledAt)))
        .returning({ role: staff.role, passwordHash: staff.passwordHash }),
    );
    if (!row) throw this.expired();
    this.assertPasswordUnchanged(state, row.passwordHash);

    await this.finish(token, state.staffId);
    await this.trail.record(AUTH_AUDIT_ACTIONS.mfaEnrolled, state.staffId, meta, {
      recoveryCodes: RECOVERY_CODE_COUNT,
    });
    return {
      userId: state.staffId,
      role: row.role,
      passwordHash: row.passwordHash,
      method: 'enrollment',
      recoveryCodes,
    };
  }

  /** Zera o MFA de uma conta (perda do aparelho + dos códigos). Uso: script operacional. */
  async reset(staffId: string, meta: AccessMeta = {}): Promise<boolean> {
    const rows = await this.db.runAsSystem((tx) =>
      tx
        .update(staff)
        .set({
          mfaSecretCipher: null,
          mfaEnabledAt: null,
          mfaLastStep: null,
          mfaRecoveryHashes: null,
        })
        .where(eq(staff.id, staffId))
        .returning({ id: staff.id }),
    );
    if (rows.length === 0) return false;
    await this.trail.record(AUTH_AUDIT_ACTIONS.mfaReset, staffId, meta);
    return true;
  }

  // --- internos --------------------------------------------------------------

  private challengeKey(token: string): string {
    return this.keys.global('mfa-challenge', sha256(token));
  }

  private async loadChallenge(token: string, mode: MfaMode): Promise<ChallengeState> {
    if (!/^[0-9a-f]{64}$/.test(token)) throw this.expired();
    const raw = await this.redis.get(this.challengeKey(token));
    if (!raw) throw this.expired();
    const state = JSON.parse(raw) as ChallengeState;
    if (state.mode !== mode) throw this.expired();
    return state;
  }

  private async saveChallenge(token: string, state: ChallengeState): Promise<void> {
    // KEEPTTL: reescrever o estado não renova o prazo de 5 min.
    await this.redis.set(this.challengeKey(token), JSON.stringify(state), 'KEEPTTL');
  }

  private async finish(token: string, staffId: string): Promise<void> {
    await this.redis.del(
      this.challengeKey(token),
      this.keys.global('mfa-challenge', sha256(token), 'wrong'),
      this.keys.global('mfa-fail', staffId),
    );
  }

  private assertPasswordUnchanged(state: ChallengeState, currentHash: string): void {
    if (state.passwordFingerprint !== sha256(currentHash)) throw this.expired();
  }

  private expired(): UnauthorizedException {
    return new UnauthorizedException('Desafio expirado. Entre novamente com e-mail e senha.');
  }

  private async assertNotLocked(staffId: string): Promise<void> {
    const failures = Number((await this.redis.get(this.keys.global('mfa-fail', staffId))) ?? 0);
    if (failures >= LOCK_THRESHOLD) {
      throw new HttpException(
        'Muitas tentativas de código. Aguarde 15 minutos e tente de novo.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Conta o erro; ao 5º erro o desafio é destruído (volta à senha), ao 10º a conta trava. */
  private async registerFailure(token: string, staffId: string, meta: AccessMeta): Promise<void> {
    const wrongKey = this.keys.global('mfa-challenge', sha256(token), 'wrong');
    const wrong = await this.redis.incr(wrongKey);
    if (wrong === 1) await this.redis.expire(wrongKey, MFA_CHALLENGE_TTL_SECONDS);
    if (wrong >= CHALLENGE_MAX_WRONG_CODES) await this.redis.del(this.challengeKey(token));

    const failKey = this.keys.global('mfa-fail', staffId);
    const failures = await this.redis.incr(failKey);
    if (failures === 1) await this.redis.expire(failKey, LOCK_WINDOW_SECONDS);
    await this.trail.recordFailedMfa(staffId, meta);
  }

  /** UPDATE condicional: só o 1º uso concorrente de um passo vence. */
  private async claimStep(staffId: string, step: number): Promise<boolean> {
    const rows = await this.db.runAsSystem((tx) =>
      tx
        .update(staff)
        .set({ mfaLastStep: step })
        .where(
          and(eq(staff.id, staffId), or(isNull(staff.mfaLastStep), lt(staff.mfaLastStep, step))),
        )
        .returning({ id: staff.id }),
    );
    return rows.length === 1;
  }

  private async consumeRecoveryCode(staffId: string, code: string): Promise<boolean> {
    const hash = hashRecoveryCode(code);
    const rows = await this.db.runAsSystem((tx) =>
      tx
        .update(staff)
        .set({ mfaRecoveryHashes: sql`array_remove(${staff.mfaRecoveryHashes}, ${hash})` })
        .where(and(eq(staff.id, staffId), sql`${hash} = ANY(${staff.mfaRecoveryHashes})`))
        .returning({ id: staff.id }),
    );
    return rows.length === 1;
  }

  private async remainingRecoveryCodes(staffId: string): Promise<number> {
    const [row] = await this.db.runAsSystem((tx) =>
      tx
        .select({ hashes: staff.mfaRecoveryHashes })
        .from(staff)
        .where(eq(staff.id, staffId))
        .limit(1),
    );
    return row?.hashes?.length ?? 0;
  }
}

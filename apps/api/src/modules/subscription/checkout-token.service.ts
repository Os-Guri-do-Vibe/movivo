import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { uuidSchema } from '@movivo/shared';

import { AppConfigService } from '../../core/config';

const IV_BYTES = 12;
const TAG_BYTES = 16;
const TTL_MS = 72 * 60 * 60 * 1_000;

interface CheckoutTokenPayload {
  userId: string;
  expiresAt: number;
  nonce: string;
}

/** Token opaco, autenticado e expirável do checkout enviado pelo WhatsApp. */
@Injectable()
export class CheckoutTokenService {
  private readonly key: Buffer;

  constructor(config: AppConfigService) {
    this.key = createHash('sha256')
      .update('movivo:checkout-token:v1\0')
      .update(config.pgcryptoKey)
      .digest();
  }

  issue(userId: string, now = new Date()): { token: string; expiresAt: Date } {
    const expiresAt = new Date(now.getTime() + TTL_MS);
    const payload: CheckoutTokenPayload = {
      userId,
      expiresAt: expiresAt.getTime(),
      nonce: randomBytes(16).toString('base64url'),
    };
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ]);
    return {
      token: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url'),
      expiresAt,
    };
  }

  verify(token: string, now = new Date()): CheckoutTokenPayload | null {
    if (!/^[A-Za-z0-9_-]{40,1024}$/.test(token)) return null;
    try {
      const packed = Buffer.from(token, 'base64url');
      if (packed.length <= IV_BYTES + TAG_BYTES) return null;
      const iv = packed.subarray(0, IV_BYTES);
      const tag = packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
      const ciphertext = packed.subarray(IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      const parsed: unknown = JSON.parse(
        Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'),
      );
      if (!isPayload(parsed) || parsed.expiresAt <= now.getTime()) return null;
      return parsed;
    } catch {
      return null;
    }
  }
}

function isPayload(value: unknown): value is CheckoutTokenPayload {
  if (typeof value !== 'object' || value === null) return false;
  const payload = value as Partial<CheckoutTokenPayload>;
  return (
    typeof payload.userId === 'string' &&
    uuidSchema.safeParse(payload.userId).success &&
    typeof payload.expiresAt === 'number' &&
    Number.isFinite(payload.expiresAt) &&
    typeof payload.nonce === 'string'
  );
}

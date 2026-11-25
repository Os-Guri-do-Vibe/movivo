/**
 * Fluxo de revogação da autorização das fotos pelo WhatsApp: pedido → confirmação → revogação.
 * A pendência fica no Redis por 15 minutos, no namespace do aluno. Revogar apaga as fotos
 * (ver `ConsentService.revoke`) e é registrado com `revoked_at`, nunca por DELETE da linha.
 */
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { REDIS_CLIENT, REDIS_KEY_BUILDER, type RedisKeyBuilder } from '../../core/redis';
import { ConsentService } from '../anamnesis/consent.service';
import {
  answersConfirmation,
  asksToRevokePhotoConsent,
  PHOTO_REVOCATION_CONFIRM_MESSAGE,
  PHOTO_REVOCATION_DECLINED_MESSAGE,
  PHOTO_REVOCATION_DONE_MESSAGE,
  PHOTO_REVOCATION_FAILED_MESSAGE,
  PHOTO_REVOCATION_NOTHING_MESSAGE,
} from './photo-consent-revocation';

const PENDING_TTL_SECONDS = 15 * 60;

@Injectable()
export class PhotoConsentRevocationService {
  constructor(
    private readonly consents: ConsentService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PhotoConsentRevocationService.name);
  }

  /** Resposta pronta quando a mensagem faz parte do fluxo; `null` deixa a conversa seguir normal. */
  async handle(userId: string, text: string): Promise<string | null> {
    const pendingKey = this.keys.forUser(userId, 'privacy', 'photo-revocation-pending');

    if ((await this.redis.get(pendingKey)) !== null) {
      const answer = answersConfirmation(text);
      if (answer === null) {
        // Mudou de assunto: a pendência expira sozinha e nada é apagado sem um "sim".
        await this.redis.del(pendingKey);
        return null;
      }
      await this.redis.del(pendingKey);
      return answer ? this.revoke(userId) : PHOTO_REVOCATION_DECLINED_MESSAGE;
    }

    if (!asksToRevokePhotoConsent(text)) return null;
    if (!(await this.consents.hasActive(userId, 'BODY_PHOTOS'))) {
      return PHOTO_REVOCATION_NOTHING_MESSAGE;
    }
    await this.redis.set(pendingKey, '1', 'EX', PENDING_TTL_SECONDS);
    return PHOTO_REVOCATION_CONFIRM_MESSAGE;
  }

  private async revoke(userId: string): Promise<string> {
    try {
      await this.consents.revoke(userId, 'BODY_PHOTOS');
      this.logger.info({ event: 'photo_consent_revoked_whatsapp', userId }, 'fotos revogadas');
      return PHOTO_REVOCATION_DONE_MESSAGE;
    } catch (err: unknown) {
      this.logger.error({ userId, err, event: 'photo_consent_revoke_failed' }, 'revogação falhou');
      return PHOTO_REVOCATION_FAILED_MESSAGE;
    }
  }
}

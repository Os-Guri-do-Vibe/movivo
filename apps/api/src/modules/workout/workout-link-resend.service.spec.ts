import { GoneException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../../core/config';
import type { RedisKeyBuilder } from '../../core/redis';
import type { QueueManager } from '../jobs/queue-manager.service';
import type { ShortLinkService } from '../short-link/short-link.service';
import type { WorkoutAccessService } from './workout-access.service';
import { WorkoutLinkResendService } from './workout-link-resend.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'a'.repeat(43);

function make(options: { owner?: boolean; cooldown?: boolean; enqueueFails?: boolean } = {}) {
  const owner =
    options.owner === false
      ? null
      : { userId: USER_ID, workoutSessionId: 's-1', name: 'Ana Souza' };
  const createMagicLink = vi.fn(async () => 'https://movivo.test/treino/acessar#token=secret');
  const enqueue = vi.fn(async () => {
    if (options.enqueueFails) throw new Error('redis fora');
    return 'job';
  });
  const redis = {
    set: vi.fn(async () => (options.cooldown ? null : 'OK')),
    del: vi.fn(async () => 1),
  };
  const service = new WorkoutLinkResendService(
    {
      findMagicOwner: vi.fn(async () => owner),
      createMagicLink,
    } as unknown as WorkoutAccessService,
    { create: vi.fn(async () => 'aB3xK9pQ') } as unknown as ShortLinkService,
    { enqueue } as unknown as QueueManager,
    { whatsapp: { publicSiteUrl: 'https://movivo.test' } } as unknown as AppConfigService,
    redis as never,
    {
      forUser: (id: string, ...p: string[]) => `u:${id}:${p.join(':')}`,
    } as unknown as RedisKeyBuilder,
  );
  return { service, createMagicLink, enqueue, redis };
}

describe('WorkoutLinkResendService', () => {
  it('envia o novo link so pelo WhatsApp do dono, reaproveitando a sessao de treino', async () => {
    const { service, createMagicLink, enqueue } = make();

    await expect(service.resend(TOKEN)).resolves.toBe('SENT');

    expect(createMagicLink).toHaveBeenCalledWith(USER_ID, 's-1');
    expect(enqueue).toHaveBeenCalledWith(
      expect.any(String),
      'workout-daily-link',
      expect.objectContaining({
        userId: USER_ID,
        type: 'WORKOUT_DAILY_LINK',
        text: expect.stringContaining('https://movivo.test/check-in/aB3xK9pQ'),
      }),
      expect.anything(),
    );
  });

  it('link desconhecido: 410, sem enviar nada', async () => {
    const { service, enqueue } = make({ owner: false });
    await expect(service.resend(TOKEN)).rejects.toBeInstanceOf(GoneException);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('dentro do intervalo de espera: nao reenvia', async () => {
    const { service, enqueue } = make({ cooldown: true });
    await expect(service.resend(TOKEN)).resolves.toBe('THROTTLED');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('falha ao enfileirar: libera o intervalo de espera para tentar de novo', async () => {
    const { service, redis } = make({ enqueueFails: true });
    await expect(service.resend(TOKEN)).rejects.toThrow('redis fora');
    expect(redis.del).toHaveBeenCalledWith(`u:${USER_ID}:workout-link:resend`);
  });
});

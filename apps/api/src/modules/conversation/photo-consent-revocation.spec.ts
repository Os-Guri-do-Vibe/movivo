import { describe, expect, it, vi } from 'vitest';

import type { RedisKeyBuilder } from '../../core/redis';
import type { ConsentService } from '../anamnesis/consent.service';
import { answersConfirmation, asksToRevokePhotoConsent } from './photo-consent-revocation';
import { PhotoConsentRevocationService } from './photo-consent-revocation.service';

describe('asksToRevokePhotoConsent', () => {
  it.each([
    'Quero apagar minhas fotos',
    'quero retirar a autorização das fotos',
    'Não quero mais que usem minhas fotos',
    'pode excluir as minhas fotos do corpo?',
    'revogar o consentimento das fotos',
  ])('reconhece "%s"', (text) => {
    expect(asksToRevokePhotoConsent(text)).toBe(true);
  });

  it.each([
    'posso mandar minhas fotos de novo?',
    'tirei uma foto do meu prato',
    'quero remover o frango do almoço',
    'cancela o treino de hoje',
    'ok',
  ])('ignora "%s"', (text) => {
    expect(asksToRevokePhotoConsent(text)).toBe(false);
  });
});

describe('answersConfirmation', () => {
  it('lê sim, não e o que não é nenhum dos dois', () => {
    expect(answersConfirmation('Sim')).toBe(true);
    expect(answersConfirmation('  pode apagar')).toBe(true);
    expect(answersConfirmation('Não, deixa')).toBe(false);
    expect(answersConfirmation('melhor não')).toBe(false);
    expect(answersConfirmation('que horas é meu treino?')).toBeNull();
  });
});

function build(options: { active?: boolean; revokeFails?: boolean } = {}) {
  const store = new Map<string, string>();
  const redis = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  };
  const consents = {
    hasActive: vi.fn(async () => options.active ?? true),
    revoke: vi.fn(async () => {
      if (options.revokeFails) throw new Error('falhou');
    }),
  };
  const keys = {
    forUser: (userId: string, ...parts: string[]) => `u:${userId}:${parts.join(':')}`,
  } as unknown as RedisKeyBuilder;
  const logger = { setContext: vi.fn(), info: vi.fn(), error: vi.fn() };
  const service = new PhotoConsentRevocationService(
    consents as unknown as ConsentService,
    redis as never,
    keys,
    logger as never,
  );
  return { service, consents, redis };
}

describe('PhotoConsentRevocationService', () => {
  it('pedido abre a confirmação e não apaga nada', async () => {
    const { service, consents } = build();
    const reply = await service.handle('user-1', 'quero apagar minhas fotos');
    expect(reply).toMatch(/Responda SIM/);
    expect(consents.revoke).not.toHaveBeenCalled();
  });

  it('"sim" depois do pedido revoga a autorização das fotos', async () => {
    const { service, consents } = build();
    await service.handle('user-1', 'quero apagar minhas fotos');
    const reply = await service.handle('user-1', 'sim');
    expect(consents.revoke).toHaveBeenCalledWith('user-1', 'BODY_PHOTOS');
    expect(reply).toMatch(/apaguei as suas fotos/);
  });

  it('"sim" sem pedido antes não revoga nada e a conversa segue', async () => {
    const { service, consents } = build();
    expect(await service.handle('user-1', 'sim')).toBeNull();
    expect(consents.revoke).not.toHaveBeenCalled();
  });

  it('"não" mantém tudo e encerra a pendência', async () => {
    const { service, consents } = build();
    await service.handle('user-1', 'retirar a autorização das fotos');
    expect(await service.handle('user-1', 'não')).toMatch(/deixei tudo como estava/);
    expect(await service.handle('user-1', 'sim')).toBeNull();
    expect(consents.revoke).not.toHaveBeenCalled();
  });

  it('mudar de assunto limpa a pendência: um "sim" depois não apaga', async () => {
    const { service, consents } = build();
    await service.handle('user-1', 'apagar minhas fotos');
    expect(await service.handle('user-1', 'qual é o meu treino de amanhã?')).toBeNull();
    expect(await service.handle('user-1', 'sim')).toBeNull();
    expect(consents.revoke).not.toHaveBeenCalled();
  });

  it('sem autorização ativa avisa e não abre confirmação', async () => {
    const { service, redis } = build({ active: false });
    expect(await service.handle('user-1', 'apagar minhas fotos')).toMatch(/Não encontrei/);
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('falha ao revogar responde com o aviso e não diz que apagou', async () => {
    const { service } = build({ revokeFails: true });
    await service.handle('user-1', 'apagar minhas fotos');
    const reply = await service.handle('user-1', 'sim');
    expect(reply).toMatch(/Não consegui concluir/);
    expect(reply).not.toMatch(/apaguei/);
  });
});

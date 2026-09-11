/**
 * Unitários do `ProtocolRenewalController`.
 *
 * Controller fino: prova a delegação de cada rota ao `ProtocolRenewalService` e a
 * validação do parâmetro `:n` (1-5) antes de chamar `patchStep`.
 */
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { ProtocolRenewalController } from './protocol-renewal.controller';
import type { ProtocolRenewalService } from './protocol-renewal.service';

const TOKEN = 'a'.repeat(64);

function makeController(overrides: Partial<Record<keyof ProtocolRenewalService, unknown>> = {}) {
  const renewal = {
    getByToken: vi.fn(async () => ({ firstName: 'Maria' })),
    patchStep: vi.fn(async () => ({ status: 'SAVED' })),
    submit: vi.fn(async () => ({ status: 'SUBMITTED' })),
    ...overrides,
  } as unknown as ProtocolRenewalService;
  return { controller: new ProtocolRenewalController(renewal), renewal };
}

describe('ProtocolRenewalController', () => {
  it('GET session/:token delega ao service', async () => {
    const { controller, renewal } = makeController();
    const result = await controller.get(TOKEN);
    expect(renewal.getByToken).toHaveBeenCalledWith(TOKEN);
    expect(result).toEqual({ firstName: 'Maria' });
  });

  it.each(['1', '2', '3', '4', '5'] as const)(
    'PATCH session/:token/step/%s delega com o número do bloco',
    async (n) => {
      const { controller, renewal } = makeController();
      await controller.patchStep(TOKEN, n, { any: 'body' });
      expect(renewal.patchStep).toHaveBeenCalledWith(TOKEN, Number(n), { any: 'body' });
    },
  );

  it.each(['0', '6', 'x', ''])(
    'PATCH session/:token/step/%s com bloco fora de 1-5 → 400 sem tocar o service',
    async (n) => {
      const { controller, renewal } = makeController();
      await expect(controller.patchStep(TOKEN, n, {})).rejects.toBeInstanceOf(BadRequestException);
      expect(renewal.patchStep).not.toHaveBeenCalled();
    },
  );

  it('POST session/:token/submit delega ao service', async () => {
    const { controller, renewal } = makeController();
    const result = await controller.submit(TOKEN);
    expect(renewal.submit).toHaveBeenCalledWith(TOKEN);
    expect(result).toEqual({ status: 'SUBMITTED' });
  });
});

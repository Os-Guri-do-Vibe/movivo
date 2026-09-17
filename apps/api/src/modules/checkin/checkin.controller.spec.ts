/**
 * Unitários do `CheckinController`.
 *
 * Controller fino: prova a delegação de cada rota ao `CheckinService`. Diferente da
 * renovação de mesociclo, não há PATCH por etapa — só `get` e `submit`.
 */
import { describe, expect, it, vi } from 'vitest';

import { CheckinController } from './checkin.controller';
import type { CheckinService } from './checkin.service';

const TOKEN = 'a'.repeat(64);

function makeController(overrides: Partial<Record<keyof CheckinService, unknown>> = {}) {
  const checkin = {
    getByToken: vi.fn(async () => ({ status: 'PENDING' })),
    submit: vi.fn(async () => ({ status: 'SUBMITTED' })),
    ...overrides,
  } as unknown as CheckinService;
  return { controller: new CheckinController(checkin), checkin };
}

describe('CheckinController', () => {
  it('GET session/:token delega ao service', async () => {
    const { controller, checkin } = makeController();
    const result = await controller.get(TOKEN);
    expect(checkin.getByToken).toHaveBeenCalledWith(TOKEN);
    expect(result).toEqual({ status: 'PENDING' });
  });

  it('POST session/:token/submit delega ao service com o corpo recebido', async () => {
    const { controller, checkin } = makeController();
    const body = { sleepQuality: 'BOA' };
    const result = await controller.submit(TOKEN, body);
    expect(checkin.submit).toHaveBeenCalledWith(TOKEN, body);
    expect(result).toEqual({ status: 'SUBMITTED' });
  });
});

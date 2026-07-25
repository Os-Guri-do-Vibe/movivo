/**
 * Unitários do `AnamnesisController` (US-1.3 / TASK-1.3.1).
 *
 * Controller fino: a regra vive no serviço. Aqui prova-se a fronteira — validação
 * Zod compartilhada por bloco e a rejeição de número de bloco inválido (só 1/2/3).
 */
import { PARQ_QUESTION_IDS, PARQ_VERSION } from '@movivo/shared';
import { describe, expect, it, vi } from 'vitest';

import { AnamnesisController } from './anamnesis.controller';
import { type AnamnesisService } from './anamnesis.service';

function makeController() {
  const svc = {
    start: vi.fn(() => Promise.resolve({ token: 'x', expiresAt: new Date(), lastBlock: 1 })),
    getByToken: vi.fn(() => Promise.resolve({})),
    patchBlock: vi.fn(() => Promise.resolve({ lastBlock: 2 })),
    submit: vi.fn(() => Promise.resolve({ status: 'SUBMITTED' })),
  } as unknown as AnamnesisService;
  return { controller: new AnamnesisController(svc), svc };
}

const block2 = {
  parq: {
    version: PARQ_VERSION,
    answers: PARQ_QUESTION_IDS.map((questionId) => ({ questionId, answer: false })),
  },
};

describe('AnamnesisController', () => {
  it('start valida o corpo e delega ao serviço', async () => {
    const { controller, svc } = makeController();
    await controller.start({ primaryGoal: 'GAIN_MUSCLE' });
    expect(svc.start).toHaveBeenCalledWith({ primaryGoal: 'GAIN_MUSCLE' });
  });

  it('start aceita corpo vazio (objetivo é opcional)', async () => {
    const { controller, svc } = makeController();
    await controller.start(undefined);
    expect(svc.start).toHaveBeenCalledWith({});
  });

  it('patch valida o bloco pelo schema correto e delega', async () => {
    const { controller, svc } = makeController();
    await controller.patch('tok', '2', block2);
    expect(svc.patchBlock).toHaveBeenCalledWith(
      'tok',
      2,
      expect.objectContaining({ parq: expect.anything() }),
    );
  });

  it('patch rejeita número de bloco inválido (só 1/2/3)', async () => {
    const { controller, svc } = makeController();
    await expect(controller.patch('tok', '9', {})).rejects.toThrow(/bloco inválido/i);
    expect(svc.patchBlock).not.toHaveBeenCalled();
  });

  it('get e submit delegam pelo token', async () => {
    const { controller, svc } = makeController();
    await controller.get('tok');
    await controller.submit('tok');
    expect(svc.getByToken).toHaveBeenCalledWith('tok');
    expect(svc.submit).toHaveBeenCalledWith('tok');
  });
});

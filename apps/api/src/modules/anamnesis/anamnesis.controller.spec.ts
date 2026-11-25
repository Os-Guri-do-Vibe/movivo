/**
 * Unitários do `AnamnesisController` (Sprint 6).
 *
 * Controller fino: a regra vive no serviço. Aqui prova-se a fronteira — validação Zod
 * compartilhada, rejeição de etapa inválida (só 1/2/3) e o fato de nenhum endpoint
 * aceitar escopo do cliente: tudo é resolvido pelo token do path (ADR-006).
 */
import { describe, expect, it, vi } from 'vitest';

import { AnamnesisController } from './anamnesis.controller';
import { type AnamnesisService } from './anamnesis.service';
import { type BodyPhotoService } from './body-photo.service';

function makeController() {
  const svc = {
    start: vi.fn(() => Promise.resolve({ token: 'x', expiresAt: new Date(), currentStep: 1 })),
    getByToken: vi.fn(() => Promise.resolve({})),
    patchStep: vi.fn(() => Promise.resolve({ currentStep: 2 })),
    sendPhoneCode: vi.fn(() => Promise.resolve({ sent: true })),
    verifyPhoneCode: vi.fn(() => Promise.resolve({ phoneVerified: true })),
    submit: vi.fn(() => Promise.resolve({ status: 'SUBMITTED', outcome: 'READY' })),
  } as unknown as AnamnesisService;
  const photos = {
    put: vi.fn((_token: string, angle: string) => Promise.resolve({ angle })),
    remove: vi.fn((_token: string, angle: string) => Promise.resolve({ angle })),
  } as unknown as BodyPhotoService;
  return { controller: new AnamnesisController(svc, photos), svc, photos };
}

describe('AnamnesisController', () => {
  it('start valida o corpo e delega ao serviço', async () => {
    const { controller, svc } = makeController();
    await controller.start({ primaryGoal: 'SPORT_EVENT' });
    expect(svc.start).toHaveBeenCalledWith({ planId: 'MONTHLY', primaryGoal: 'SPORT_EVENT' });
  });

  it('start aceita corpo vazio (objetivo é opcional)', async () => {
    const { controller, svc } = makeController();
    await controller.start(undefined);
    expect(svc.start).toHaveBeenCalledWith({ planId: 'MONTHLY' });
  });

  it('start recusa objetivo fora do vocabulário do RT', async () => {
    const { controller, svc } = makeController();
    await expect(controller.start({ primaryGoal: 'LOSE_WEIGHT' })).rejects.toThrow();
    expect(svc.start).not.toHaveBeenCalled();
  });

  it('patchStep delega o corpo cru — o schema de cada etapa é aplicado no serviço', async () => {
    const { controller, svc } = makeController();
    await controller.patchStep('tok', '2', { anamnesis: {}, pain: {} });
    expect(svc.patchStep).toHaveBeenCalledWith('tok', 2, { anamnesis: {}, pain: {} });
  });

  it('patchStep rejeita etapa inválida (só de 1 a 9)', async () => {
    const { controller, svc } = makeController();
    await expect(controller.patchStep('tok', '10', {})).rejects.toThrow(/etapa inválida/i);
    expect(svc.patchStep).not.toHaveBeenCalled();
  });

  it('send-code exige telefone em E.164', async () => {
    const { controller, svc } = makeController();
    await controller.sendPhoneCode('tok', { phoneNumber: '+5511999998888' });
    expect(svc.sendPhoneCode).toHaveBeenCalledWith('tok', '+5511999998888');
    await expect(controller.sendPhoneCode('tok', { phoneNumber: '11999998888' })).rejects.toThrow();
  });

  it('verify exige exatamente 6 dígitos', async () => {
    const { controller, svc } = makeController();
    await controller.verifyPhoneCode('tok', { code: '012345' });
    expect(svc.verifyPhoneCode).toHaveBeenCalledWith('tok', '012345');
    await expect(controller.verifyPhoneCode('tok', { code: '12a45' })).rejects.toThrow();
    await expect(controller.verifyPhoneCode('tok', { code: '1234567' })).rejects.toThrow();
  });

  it('get e submit delegam pelo token', async () => {
    const { controller, svc } = makeController();
    await controller.get('tok');
    await controller.submit('tok');
    expect(svc.getByToken).toHaveBeenCalledWith('tok');
    expect(svc.submit).toHaveBeenCalledWith('tok');
  });

  it('putPhoto entrega os bytes da imagem à posição validada', async () => {
    const { controller, photos } = makeController();
    const bytes = Buffer.from([0xff, 0xd8, 0xff]);
    await controller.putPhoto('tok', 'FRONT', { body: bytes });
    expect(photos.put).toHaveBeenCalledWith('tok', 'FRONT', bytes);
  });

  it('putPhoto sem corpo binário envia vazio (o serviço recusa)', async () => {
    const { controller, photos } = makeController();
    await controller.putPhoto('tok', 'BACK', { body: { not: 'bytes' } });
    expect(photos.put).toHaveBeenCalledWith('tok', 'BACK', Buffer.alloc(0));
  });

  it('foto e exclusão recusam posição fora das quatro', async () => {
    const { controller, photos } = makeController();
    await expect(controller.putPhoto('tok', 'SIDE', { body: Buffer.alloc(1) })).rejects.toThrow(
      /Posição da foto inválida/,
    );
    await expect(controller.deletePhoto('tok', 'TOP')).rejects.toThrow(/inválida/);
    expect(photos.put).not.toHaveBeenCalled();
    await controller.deletePhoto('tok', 'LEFT');
    expect(photos.remove).toHaveBeenCalledWith('tok', 'LEFT');
  });
});

import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { MethodologyAdminController } from './methodology-admin.controller';
import type { MethodologyAdminService } from './methodology-admin.service';

const ACTOR = {
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'ADMIN',
  jti: 'j1',
} as const as AuthenticatedUser;

const VERSION_ID = '33333333-3333-4333-8333-333333333333';

function controllerWith() {
  const service = {
    list: vi.fn().mockResolvedValue('list-result'),
    create: vi.fn().mockResolvedValue('create-result'),
    submit: vi.fn().mockResolvedValue('submit-result'),
    review: vi.fn().mockResolvedValue('review-result'),
    publish: vi.fn().mockResolvedValue('publish-result'),
    rollback: vi.fn().mockResolvedValue('rollback-result'),
  } as unknown as MethodologyAdminService;
  const controller = new MethodologyAdminController(service);
  return { controller, service };
}

describe('MethodologyAdminController', () => {
  it('list delega ao serviço com o ator autenticado', async () => {
    const { controller, service } = controllerWith();
    await expect(controller.list(ACTOR)).resolves.toBe('list-result');
    expect(service.list).toHaveBeenCalledWith(ACTOR);
  });

  it('create delega o corpo bruto ao serviço (o schema fechado é responsabilidade dele)', async () => {
    const { controller, service } = controllerWith();
    const body = { content: 'x'.repeat(200), changeNote: 'Nota válida' };
    await expect(controller.create(ACTOR, body)).resolves.toBe('create-result');
    expect(service.create).toHaveBeenCalledWith(ACTOR, body);
  });

  it('submit repassa a nota válida ao serviço', async () => {
    const { controller, service } = controllerWith();
    await expect(
      controller.submit(ACTOR, VERSION_ID, { note: 'Pronta para revisão CREF' }),
    ).resolves.toBe('submit-result');
    expect(service.submit).toHaveBeenCalledWith(ACTOR, {
      versionId: VERSION_ID,
      note: 'Pronta para revisão CREF',
    });
  });

  it('submit rejeita nota fora do contrato antes de chamar o serviço', async () => {
    const { controller, service } = controllerWith();
    expect(() => controller.submit(ACTOR, VERSION_ID, { note: 'oi' })).toThrow(BadRequestException);
    expect(service.submit).not.toHaveBeenCalled();
  });

  it('review repassa nota e decisão ao serviço', async () => {
    const { controller, service } = controllerWith();
    const body = { note: 'Parecer técnico registrado', decision: 'APPROVED' as const };
    await expect(controller.review(ACTOR, VERSION_ID, body)).resolves.toBe('review-result');
    expect(service.review).toHaveBeenCalledWith(
      ACTOR,
      { versionId: VERSION_ID, note: body.note },
      'APPROVED',
    );
  });

  it('review rejeita decisão fora do enum antes de chamar o serviço', async () => {
    const { controller, service } = controllerWith();
    expect(() =>
      controller.review(ACTOR, VERSION_ID, { note: 'Parecer técnico registrado', decision: 'X' }),
    ).toThrow(BadRequestException);
    expect(service.review).not.toHaveBeenCalled();
  });

  it('publish repassa a nota válida ao serviço', async () => {
    const { controller, service } = controllerWith();
    await expect(
      controller.publish(ACTOR, VERSION_ID, { note: 'Publicação autorizada pelo RT' }),
    ).resolves.toBe('publish-result');
    expect(service.publish).toHaveBeenCalledWith(ACTOR, {
      versionId: VERSION_ID,
      note: 'Publicação autorizada pelo RT',
    });
  });

  it('publish rejeita nota fora do contrato antes de chamar o serviço', async () => {
    const { controller, service } = controllerWith();
    expect(() => controller.publish(ACTOR, VERSION_ID, { note: 'oi' })).toThrow(
      BadRequestException,
    );
    expect(service.publish).not.toHaveBeenCalled();
  });

  it('rollback repassa a nota válida ao serviço', async () => {
    const { controller, service } = controllerWith();
    await expect(
      controller.rollback(ACTOR, VERSION_ID, { note: 'Reverter para a v1 aprovada' }),
    ).resolves.toBe('rollback-result');
    expect(service.rollback).toHaveBeenCalledWith(ACTOR, {
      versionId: VERSION_ID,
      note: 'Reverter para a v1 aprovada',
    });
  });

  it('rollback rejeita nota fora do contrato antes de chamar o serviço', async () => {
    const { controller, service } = controllerWith();
    expect(() => controller.rollback(ACTOR, VERSION_ID, { note: 'oi' })).toThrow(
      BadRequestException,
    );
    expect(service.rollback).not.toHaveBeenCalled();
  });
});

/**
 * Unitários do `ProtocolController` (US-2.6 / TASK-2.6.1).
 *
 * Controller fino: prova a fronteira IDOR-safe — token inválido → 404 sem tocar o
 * repositório; protocolo inexistente/não-ACTIVE (`findById` = null) → 404; token
 * UUID válido delega e devolve o DTO.
 */
import { NotFoundException } from '@nestjs/common';
import type { ProtocolRead } from '@movivo/shared';
import { describe, expect, it, vi } from 'vitest';

import { ProtocolController } from './protocol.controller';
import { type ProtocolRepository } from './protocol.repository';

const dto: ProtocolRead = {
  content: {
    promptVersion: 'v1',
    goal: 'GAIN_MUSCLE',
    phase: 'ADAPTACAO',
    phaseDurationWeeks: 3,
    weeklyFrequency: 3,
    sessions: [
      {
        dayLabel: 'A',
        focus: 'Full body',
        exercises: [
          {
            exerciseId: 'goblet_squat',
            name: 'Agachamento',
            sets: 3,
            reps: { min: 8, max: 12 },
            loadStrategy: 'DOUBLE_PROGRESSION',
            restSeconds: 90,
          },
        ],
      },
    ],
  },
  status: 'ACTIVE',
  approvalStatus: 'AUTO_APPROVED',
  professionalId: '00000000-0000-4000-8000-000000000001',
  signatureHash: 'a'.repeat(64),
  signedAt: '2026-07-30T12:00:00.000Z',
  totalWeeks: 12,
  currentWeek: 1,
  mesocycleName: 'Mesociclo 1: Adaptação',
  startDate: '2026-07-30T12:00:00.000Z',
  endDate: '2026-10-22T12:00:00.000Z',
};

const VALID_TOKEN = 'A'.repeat(43);
const VALID_UUID = '11111111-1111-4111-8111-111111111111';

function makeController(
  findById = vi.fn(() => Promise.resolve<ProtocolRead | null>(dto)),
  findPdfById = vi.fn(() => Promise.resolve<Buffer | null>(Buffer.from('%PDF-1.4'))),
) {
  const repo = { findById, findPdfById } as unknown as ProtocolRepository;
  return {
    controller: new ProtocolController(repo, {
      verify: vi.fn(async (token: string) =>
        token === VALID_TOKEN ? { userId: VALID_UUID, resourceId: VALID_UUID } : null,
      ),
    } as never),
    findById,
    findPdfById,
  };
}

function fakeResponse() {
  return {
    setHeader: vi.fn(),
    send: vi.fn(),
  } as unknown as import('express').Response;
}

describe('ProtocolController (US-2.6)', () => {
  it('token opaco válido delega e devolve o DTO (sem userId)', async () => {
    const { controller, findById } = makeController();
    const result = await controller.byToken(VALID_TOKEN);
    expect(findById).toHaveBeenCalledWith(VALID_UUID, VALID_UUID);
    expect(result).toBe(dto);
    expect(Object.keys(result)).not.toContain('userId');
  });

  it('token inválido → 404 sem tocar o repositório', async () => {
    const { controller, findById } = makeController();
    await expect(controller.byToken('not-a-uuid')).rejects.toBeInstanceOf(NotFoundException);
    expect(findById).not.toHaveBeenCalled();
  });

  it('protocolo inexistente/não-ACTIVE (null) → 404', async () => {
    const { controller } = makeController(vi.fn(() => Promise.resolve(null)));
    await expect(controller.byToken(VALID_TOKEN)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('PDF: token opaco válido devolve o binário com os headers corretos', async () => {
    const { controller, findPdfById } = makeController();
    const res = fakeResponse();
    await controller.pdfByToken(VALID_TOKEN, res);
    expect(findPdfById).toHaveBeenCalledWith(VALID_UUID, VALID_UUID);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'inline; filename="protocolo-movivo.pdf"',
    );
    expect(res.send).toHaveBeenCalledWith(Buffer.from('%PDF-1.4'));
  });

  it('PDF: token inválido → 404 sem tocar o repositório', async () => {
    const { controller, findPdfById } = makeController();
    await expect(controller.pdfByToken('not-a-uuid', fakeResponse())).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(findPdfById).not.toHaveBeenCalled();
  });

  it('PDF: protocolo sem PDF assinado (null) → 404', async () => {
    const { controller } = makeController(
      undefined,
      vi.fn(() => Promise.resolve(null)),
    );
    await expect(controller.pdfByToken(VALID_TOKEN, fakeResponse())).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

it('recusa ID do protocolo como credencial, inclusive no PDF', async () => {
  const { controller, findById, findPdfById } = makeController();
  await expect(controller.byToken(VALID_UUID)).rejects.toBeInstanceOf(NotFoundException);
  await expect(controller.pdfByToken(VALID_UUID, fakeResponse())).rejects.toBeInstanceOf(
    NotFoundException,
  );
  expect(findById).not.toHaveBeenCalled();
  expect(findPdfById).not.toHaveBeenCalled();
});

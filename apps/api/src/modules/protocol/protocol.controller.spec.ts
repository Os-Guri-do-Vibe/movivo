/**
 * Unitários do `ProtocolController` (US-2.6 / TASK-2.6.1).
 *
 * Controller fino: prova a fronteira IDOR-safe — token não-UUID → 404 sem tocar o
 * repositório; protocolo inexistente/não-ACTIVE (`findByToken` = null) → 404; token
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
  mesocycleName: 'Mesociclo 1 — Adaptação',
  startDate: '2026-07-30T12:00:00.000Z',
  endDate: '2026-10-22T12:00:00.000Z',
};

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

function makeController(findByToken = vi.fn(() => Promise.resolve<ProtocolRead | null>(dto))) {
  const repo = { findByToken } as unknown as ProtocolRepository;
  return { controller: new ProtocolController(repo), findByToken };
}

describe('ProtocolController (US-2.6)', () => {
  it('token UUID válido delega e devolve o DTO (sem userId)', async () => {
    const { controller, findByToken } = makeController();
    const result = await controller.byToken(VALID_UUID);
    expect(findByToken).toHaveBeenCalledWith(VALID_UUID);
    expect(result).toBe(dto);
    expect(Object.keys(result)).not.toContain('userId');
  });

  it('token não-UUID → 404 sem tocar o repositório', async () => {
    const { controller, findByToken } = makeController();
    await expect(controller.byToken('not-a-uuid')).rejects.toBeInstanceOf(NotFoundException);
    expect(findByToken).not.toHaveBeenCalled();
  });

  it('protocolo inexistente/não-ACTIVE (null) → 404', async () => {
    const { controller } = makeController(vi.fn(() => Promise.resolve(null)));
    await expect(controller.byToken(VALID_UUID)).rejects.toBeInstanceOf(NotFoundException);
  });
});

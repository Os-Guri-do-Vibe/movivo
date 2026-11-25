/**
 * "Regerar o protocolo do zero" na Fila (`POST :id/regenerate`). O banco é falso, mas a trava do
 * caso (`FOR UPDATE`) é simulada de verdade: segura até o fim da transação de quem a pegou.
 */
import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CoachingAction } from '@movivo/shared';

import { coachingProposals, exceptionCases, staff } from '../../core/database/schema';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { ExceptionsService, REGENERATION_NOTE } from './exceptions.service';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const PROPOSAL_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_ID = '33333333-3333-4333-8333-333333333333';
const STUDENT_ID = '44444444-4444-4444-8444-444444444444';
const STAFF_ID = '55555555-5555-4555-8555-555555555555';

type CaseRow = {
  id: string;
  userId: string;
  kind: string;
  domain: string;
  status: string;
  subject: Record<string, string>;
  resolution: Record<string, unknown> | null;
  reviewUrgency: string | null;
  assignedStaffId: string | null;
  resolvedAt: Date | null;
};

interface World {
  case: CaseRow;
  proposal: { id: string; action: CoachingAction; status: string } | null;
  staff: { council: string; active: boolean };
}

/** Mutex da linha do caso: o `FOR UPDATE` espera a transação anterior terminar. */
function rowLock() {
  let tail: Promise<void> = Promise.resolve();
  return (): Promise<() => void> => {
    let release!: () => void;
    const next = new Promise<void>((resolve) => (release = resolve));
    const previous = tail;
    tail = previous.then(() => next);
    return previous.then(() => release);
  };
}

function fakeDb(world: World) {
  const acquire = rowLock();
  const rowsOf = (table: unknown): unknown[] => {
    if (table === staff) return [world.staff];
    if (table === exceptionCases) return [{ ...world.case }];
    if (table === coachingProposals) return world.proposal ? [{ ...world.proposal }] : [];
    return [];
  };
  const apply = (table: unknown, values: Record<string, unknown>): unknown[] => {
    if (table === exceptionCases) {
      Object.assign(world.case, values);
      return [];
    }
    // As escritas na proposta filtram `status = 'PENDING'`.
    if (table === coachingProposals && world.proposal?.status === 'PENDING') {
      Object.assign(world.proposal, values);
      return [{ id: world.proposal.id }];
    }
    return [];
  };
  const makeTx = (held: { release?: () => void }) => ({
    select: () => {
      let table: unknown;
      let forUpdate = false;
      const chain = {
        from: (t: unknown) => ((table = t), chain),
        where: () => chain,
        innerJoin: () => chain,
        for: () => ((forUpdate = true), chain),
        then: (resolve: (rows: unknown[]) => unknown, reject: (e: unknown) => unknown) =>
          (forUpdate
            ? acquire().then((release) => {
                held.release = release;
                return rowsOf(table);
              })
            : Promise.resolve(rowsOf(table))
          ).then(resolve, reject),
      };
      return chain;
    },
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          then: (resolve: (rows: unknown[]) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve()
              .then(() => apply(table, values))
              .then(resolve, reject),
          returning: () => Promise.resolve().then(() => apply(table, values)),
        }),
      }),
    }),
  });
  return {
    runAsSystem: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
      const held: { release?: () => void } = {};
      try {
        return await work(makeTx(held));
      } finally {
        held.release?.();
      }
    },
  };
}

function setup(world: World) {
  const events = { record: vi.fn(() => Promise.resolve()) };
  const audit = { append: vi.fn(() => Promise.resolve()) };
  const outbox = { flushSoon: vi.fn(() => Promise.resolve()) };
  const hold = { hold: vi.fn(), release: vi.fn(), isHeld: vi.fn() };
  const service = new ExceptionsService(
    fakeDb(world) as never,
    {} as never, // state
    {} as never, // runner
    {} as never, // pipeline
    events as never,
    outbox as never,
    audit as never,
    {} as never, // queues
    {} as never, // store
    {} as never, // protocols
    {} as never, // cipher
    hold as never,
    {} as never, // anamnesis
    {} as never, // commands
    {} as never, // links
  );
  return { service, events, audit, outbox, hold };
}

const professional: AuthenticatedUser = { userId: STAFF_ID, role: 'PROFESSIONAL', jti: 'jti' };

function worldOf(
  action: CoachingAction | null,
  overrides: Partial<CaseRow> = {},
  council = 'CREF',
): World {
  return {
    staff: { council, active: true },
    proposal: action ? { id: PROPOSAL_ID, action, status: 'PENDING' } : null,
    case: {
      id: CASE_ID,
      userId: STUDENT_ID,
      kind: 'PROTOCOL_REVIEW',
      domain: 'TRAINING',
      status: 'OPEN',
      subject: action ? { proposalId: PROPOSAL_ID, decisionId: 'd-1' } : {},
      resolution: null,
      reviewUrgency: 'OPTIONAL',
      assignedStaffId: null,
      resolvedAt: null,
      ...overrides,
    },
  };
}

const publishTraining: CoachingAction = { type: 'PUBLISH_TRAINING_PLAN', planId: PLAN_ID };
const publishNutrition: CoachingAction = { type: 'PUBLISH_NUTRITION_PLAN', planId: PLAN_ID };
const DONE = { id: CASE_ID, status: 'RESOLVED', outcome: 'REGENERATION_REQUESTED' };
const NOW = new Date('2026-11-05T12:00:00Z');

describe('ExceptionsService.regenerateProtocol', () => {
  let world: World;

  describe('protocolo de treino', () => {
    beforeEach(() => {
      world = worldOf(publishTraining);
    });

    it('descarta a proposta, fecha o caso e pede a geração do zero (sem orientação)', async () => {
      const { service, events, outbox } = setup(world);
      await expect(service.regenerateProtocol(professional, CASE_ID, NOW)).resolves.toEqual(DONE);

      expect(world.proposal?.status).toBe('REJECTED');
      expect(world.case).toMatchObject({
        status: 'RESOLVED',
        resolvedAt: NOW,
        assignedStaffId: STAFF_ID,
        resolution: { outcome: 'REGENERATION_REQUESTED', note: REGENERATION_NOTE },
      });
      // O evento é o que leva o planejamento a refazer o protocolo.
      expect(events.record).toHaveBeenCalledTimes(1);
      expect(events.record).toHaveBeenCalledWith(expect.anything(), {
        userId: STUDENT_ID,
        type: 'ExceptionResolved',
        payload: {
          exceptionCaseId: CASE_ID,
          kind: 'PROTOCOL_REVIEW',
          outcome: 'REGENERATION_REQUESTED',
        },
      });
      expect(outbox.flushSoon).toHaveBeenCalledTimes(1);
    });

    it('registra na auditoria quem pediu e o motivo "regeneração completa"', async () => {
      const { service, audit } = setup(world);
      await service.regenerateProtocol(professional, CASE_ID, NOW);
      expect(audit.append).toHaveBeenCalledTimes(1);
      expect(audit.append).toHaveBeenCalledWith(expect.anything(), {
        actorId: STAFF_ID,
        userId: STUDENT_ID,
        action: 'exception.protocol_regenerate',
        entityType: 'exception_case',
        entityId: CASE_ID,
        changes: {
          planId: PLAN_ID,
          proposalId: PROPOSAL_ID,
          kind: 'TRAINING',
          reason: 'FULL_REGENERATION',
        },
      });
    });

    it('clique duplo (chamadas simultâneas): uma geração só, a mesma resposta nas duas', async () => {
      const { service, events, audit, outbox } = setup(world);
      const [first, second] = await Promise.all([
        service.regenerateProtocol(professional, CASE_ID, NOW),
        service.regenerateProtocol(professional, CASE_ID, NOW),
      ]);
      expect(first).toEqual(DONE);
      expect(second).toEqual(DONE);
      expect(events.record).toHaveBeenCalledTimes(1);
      expect(audit.append).toHaveBeenCalledTimes(1);
      expect(outbox.flushSoon).toHaveBeenCalledTimes(1);
    });

    it('repetir depois de pedido devolve a mesma resposta, sem novo evento', async () => {
      const { service, events } = setup(world);
      await service.regenerateProtocol(professional, CASE_ID, NOW);
      await expect(service.regenerateProtocol(professional, CASE_ID, NOW)).resolves.toEqual(DONE);
      expect(events.record).toHaveBeenCalledTimes(1);
    });

    it('o caso antigo não pode mais ser aprovado', async () => {
      const { service } = setup(world);
      await service.regenerateProtocol(professional, CASE_ID, NOW);
      await expect(service.approve(professional, CASE_ID, undefined, NOW)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  it('protocolo alimentar: o nutricionista (CRN) regera do zero', async () => {
    world = worldOf(publishNutrition, { domain: 'NUTRITION' }, 'CRN');
    const { service, audit } = setup(world);
    await expect(service.regenerateProtocol(professional, CASE_ID, NOW)).resolves.toEqual(DONE);
    expect(world.proposal?.status).toBe('REJECTED');
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        changes: expect.objectContaining({ kind: 'NUTRITION', reason: 'FULL_REGENERATION' }),
      }),
    );
  });

  describe('recusa (422) o que não é publicação de protocolo, sem escrever nada', () => {
    const cases: Array<[string, World]> = [
      [
        'troca de exercício',
        worldOf({
          type: 'SUBSTITUTE_EXERCISE',
          planSessionKey: 'A',
          fromExerciseId: 'x',
          toExerciseId: 'y',
          reason: 'OTHER',
          scope: 'PLAN',
        } as CoachingAction),
      ],
      ['ajuste de volume', worldOf({ type: 'ADJUST_WEEKLY_VOLUME' } as unknown as CoachingAction)],
      [
        'ajuste de alimentação',
        worldOf({ type: 'ADJUST_MEAL_GUIDANCE' } as unknown as CoachingAction, {
          domain: 'NUTRITION',
        }),
      ],
      ['troca sem equivalente (sem proposta)', worldOf(null, { subject: { source: 'SWAP_GAP' } })],
      [
        'falha de geração (usa resolve)',
        worldOf(null, { kind: 'DECISION_FAILURE', reviewUrgency: 'MANDATORY' }),
      ],
    ];

    it.each(cases)('%s', async (_label, scenario) => {
      if (scenario.case.domain === 'NUTRITION') scenario.staff.council = 'CRN';
      const { service, events, audit } = setup(scenario);
      await expect(service.regenerateProtocol(professional, CASE_ID, NOW)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(scenario.case.status).toBe('OPEN');
      expect(events.record).not.toHaveBeenCalled();
      expect(audit.append).not.toHaveBeenCalled();
    });

    it('a falha de geração aponta o caminho certo (resolve)', async () => {
      const { service } = setup(worldOf(null, { kind: 'DECISION_FAILURE' }));
      await expect(service.regenerateProtocol(professional, CASE_ID, NOW)).rejects.toThrow(
        /resolve/,
      );
    });
  });

  describe('recusa (409)', () => {
    it('caso já encerrado de outro jeito (aprovado, ajuste pedido)', async () => {
      world = worldOf(publishTraining, {
        status: 'RESOLVED',
        resolution: { outcome: 'APPROVED', note: null },
      });
      const { service, events } = setup(world);
      await expect(service.regenerateProtocol(professional, CASE_ID, NOW)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(events.record).not.toHaveBeenCalled();
    });

    it('caso encerrado por outro profissional enquanto este esperava a trava', async () => {
      world = worldOf(publishTraining);
      const { service, events } = setup(world);
      const adjustment = service.requestAdjustment(professional, CASE_ID, 'Menos volume', NOW);
      await expect(service.regenerateProtocol(professional, CASE_ID, NOW)).rejects.toBeInstanceOf(
        ConflictException,
      );
      await adjustment;
      expect(world.case.resolution).toMatchObject({ outcome: 'ADJUSTMENT_REQUESTED' });
      expect(events.record).toHaveBeenCalledTimes(1);
    });

    it('proposta que não está mais pendente', async () => {
      world = worldOf(publishTraining);
      if (world.proposal) world.proposal.status = 'ACCEPTED';
      const { service, events } = setup(world);
      await expect(service.regenerateProtocol(professional, CASE_ID, NOW)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(world.case.status).toBe('OPEN');
      expect(events.record).not.toHaveBeenCalled();
    });
  });

  it('registro no conselho inativo não regera (403)', async () => {
    world = worldOf(publishTraining);
    world.staff.active = false;
    const { service } = setup(world);
    await expect(service.regenerateProtocol(professional, CASE_ID, NOW)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

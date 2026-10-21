/**
 * Os dois caminhos que publicam uma versão nova do protocolo no meio do dia avisam o treino de
 * hoje pelo MESMO contrato de fila (`workout-protocol-changed`), e o aviso nunca derruba a
 * publicação:
 *
 *  - aprovação manual do profissional CREF no painel (`DashboardService.approveSubstitutionNow`)
 *    e emenda do protocolo ativo (`amendActiveProtocol`);
 *  - liberação automática da troca (`ProtocolSubstitutionReleaseWorker`, já coberta no spec dele).
 *
 * O `dashboard.service.spec.ts` existente não verifica este aviso; aqui ele é provado, e o job
 * produzido é entregue ao worker real que o consome (`WorkoutProtocolChangedWorker`).
 *
 * Unitário (roda no `vitest run` do app): o banco é uma casca, como no spec do dashboard.
 */
import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedUser } from '../../src/modules/auth/jwt.strategy';
import { DashboardService } from '../../src/modules/admin/dashboard.service';
import type { WorkoutProtocolChangedJob } from '../../src/modules/jobs/workout-protocol-changed.contract';
import { WorkoutProtocolChangedWorker } from '../../src/modules/workout/workout-protocol-changed.worker';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const RESOURCE_ID = '33333333-3333-4333-8333-333333333333';
const professional: AuthenticatedUser = { userId: ACTOR_ID, role: 'PROFESSIONAL', jti: 'jti' };
const admin: AuthenticatedUser = { userId: ACTOR_ID, role: 'ADMIN', jti: 'jti' };

const content = {
  promptVersion: 'v1',
  goal: 'CONDITIONING',
  phase: 'ADAPTACAO',
  phaseDurationWeeks: 3,
  weeklyFrequency: 1,
  sessions: [
    {
      dayLabel: 'Dia 1',
      focus: 'Corpo inteiro',
      exercises: [
        {
          exerciseId: 'goblet_squat',
          name: 'Agachamento',
          sets: 3,
          reps: { min: 8, max: 12 },
          loadStrategy: 'BODYWEIGHT',
          restSeconds: 60,
        },
      ],
    },
  ],
} as const;

const activeProtocol = {
  id: RESOURCE_ID,
  userId: USER_ID,
  createdAt: new Date('2026-08-01T12:00:00.000Z'),
  content,
  constraints: { goal: 'CONDITIONING', injuryTags: [] },
  parQFlags: [],
  status: 'ACTIVE' as const,
  approvalStatus: 'HUMAN_APPROVED' as const,
  version: 2,
  signedAt: new Date('2026-10-12T12:00:00.000Z'),
  signatureHash: 'a'.repeat(64),
  professionalId: ACTOR_ID,
  humanReviewRequired: false,
  reviewUrgency: 'OPTIONAL' as const,
  generatedBy: 'AI_WITH_RULES',
  totalWeeks: 12,
  mesocycleName: 'Mesociclo 1',
  startDate: new Date('2026-10-01T12:00:00.000Z'),
  endDate: new Date('2026-12-01T12:00:00.000Z'),
};

/** Casca de banco que devolve as seleções na ordem (mesmo molde do spec do dashboard). */
function makeDashboard(selections: unknown[][], failingQueue?: string) {
  const select = vi.fn(() => {
    const result = selections.shift() ?? [];
    const chain: Record<string, unknown> = {};
    for (const method of ['from', 'leftJoin', 'innerJoin', 'where', 'orderBy', 'for']) {
      chain[method] = () => chain;
    }
    chain.limit = async () => result;
    chain.then = (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    return chain;
  });
  const updateWhere = vi.fn(() =>
    Object.assign(Promise.resolve([]), { returning: vi.fn(async () => []) }),
  );
  const tx = {
    select,
    selectDistinct: select,
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere })) })),
    insert: vi.fn(() => ({ values: vi.fn(async () => []) })),
    execute: vi.fn(async () => []),
  };
  const db = {
    runAsUser: vi.fn((_id: string, _role: string, cb: (t: unknown) => unknown) => cb(tx)),
  };
  const enqueue = vi.fn(async (queue: string, ..._rest: unknown[]) => {
    if (queue === failingQueue) throw new Error(`fila ${queue} fora do ar`);
    return 'job';
  });
  const release = vi.fn();
  const logger = { setContext: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() };
  const service = new DashboardService(
    db as never,
    {
      validate: vi.fn(() => ({
        action: 'PASS',
        code: 'PASS',
        humanReviewRequired: false,
        violations: [],
      })),
      validateProfessionalPrescription: vi.fn(() => ({ blocking: [], conflicts: [] })),
      exerciseById: vi.fn(() => undefined),
    } as never,
    {
      decryptText: vi.fn(async (value: string) => value),
      decryptHealth: vi.fn(async () => '{}'),
      encryptBytes: vi.fn(async (value: Buffer) => value),
    } as never,
    { append: vi.fn(async () => undefined) } as never,
    { enqueue } as never,
    { emit: vi.fn(), stream: vi.fn() } as never,
    { hasActiveForUser: vi.fn(async () => true) } as never,
    { release } as never,
    { present: vi.fn(async () => undefined) } as never,
    { publish: vi.fn() } as never,
    { getById: vi.fn() } as never,
    { hold: vi.fn(async () => undefined), release: vi.fn(async () => false) } as never,
    logger as never,
  );
  return { service, enqueue, release, logger };
}

function workoutJobs(enqueue: ReturnType<typeof makeDashboard>['enqueue']) {
  return enqueue.mock.calls.filter((call) => call[0] === 'workout-protocol-changed');
}

const released = {
  released: true,
  protocolId: RESOURCE_ID,
  userId: USER_ID,
  version: 4,
  content,
  mesocycleName: 'Mesociclo 1',
  startDate: new Date('2026-01-01'),
  endDate: new Date('2026-02-01'),
  totalWeeks: 4,
  changes: [{ from: 'Rosca direta', to: 'Rosca martelo' }],
};

describe('aprovação manual da troca pelo profissional CREF (painel)', () => {
  it('avisa o treino do dia pela fila, DEPOIS de enfileirar a entrega do protocolo atualizado', async () => {
    const { service, enqueue, release } = makeDashboard([[activeProtocol]]);
    release.mockResolvedValue(released);

    await expect(service.approveSubstitutionNow(professional, RESOURCE_ID)).resolves.toMatchObject({
      released: true,
      version: 4,
    });
    expect(workoutJobs(enqueue)).toEqual([
      [
        'workout-protocol-changed',
        'workout-protocol-changed',
        { userId: USER_ID, reason: 'SUBSTITUTION', protocolVersion: 4 },
        { jobId: `workout-protocol-changed_${USER_ID}_4` },
      ],
    ]);
    const order = enqueue.mock.calls.map((call) => call[1]);
    expect(order.indexOf('protocol-delivery')).toBeLessThan(
      order.indexOf('workout-protocol-changed'),
    );
  });

  it('a fila do treino fora do ar não derruba a aprovação', async () => {
    const { service, release, logger } = makeDashboard(
      [[activeProtocol]],
      'workout-protocol-changed',
    );
    release.mockResolvedValue(released);
    await expect(service.approveSubstitutionNow(professional, RESOURCE_ID)).resolves.toMatchObject({
      released: true,
    });
    expect(logger.warn).toHaveBeenCalled();
  });

  it('proposta recusada inteira (todos os itens descartados) não avisa o treino do dia', async () => {
    const { service, enqueue, release } = makeDashboard([[activeProtocol]]);
    release.mockResolvedValue({
      released: false,
      reason: 'ALL_DISCARDED',
      userId: USER_ID,
      protocolId: RESOURCE_ID,
    });
    await service.approveSubstitutionNow(professional, RESOURCE_ID);
    expect(workoutJobs(enqueue)).toEqual([]);
  });
});

describe('emenda do protocolo ativo pelo profissional', () => {
  it('avisa o treino do dia com o motivo ADJUSTMENT e a versão nova', async () => {
    const stale = {
      id: '44444444-4444-4444-8444-444444444444',
      status: 'PENDING' as const,
      items: null,
      fromExerciseId: 'goblet_squat',
      fromExerciseName: 'Agachamento',
      toExerciseId: 'leg_press',
      toExerciseName: 'Leg press',
      catalogGap: false,
      reviewUrgency: 'OPTIONAL' as const,
    };
    const { service, enqueue } = makeDashboard([[activeProtocol], [stale]]);
    await expect(
      service.amendActiveProtocol(admin, RESOURCE_ID, {
        content,
        expectedVersion: 2,
        reason: 'Troca manual segura',
        confirmation: true,
      }),
    ).resolves.toMatchObject({ version: 3 });
    expect(workoutJobs(enqueue)).toEqual([
      [
        'workout-protocol-changed',
        'workout-protocol-changed',
        { userId: USER_ID, reason: 'ADJUSTMENT', protocolVersion: 3 },
        { jobId: `workout-protocol-changed_${USER_ID}_3` },
      ],
    ]);
  });
});

describe('o job dos dois produtores é o mesmo para quem consome', () => {
  it('painel e worker automático chegam ao WorkoutProtocolChangedWorker com o mesmo pedido', async () => {
    const onProtocolChanged = vi.fn(async () => 'OFFERED' as const);
    const worker = new WorkoutProtocolChangedWorker(
      { create: vi.fn() } as never,
      {
        onProtocolChanged,
      } as never,
    );
    const fromDashboard: WorkoutProtocolChangedJob = {
      userId: USER_ID,
      reason: 'SUBSTITUTION',
      protocolVersion: 4,
    };
    // Formato que `ProtocolSubstitutionReleaseWorker.notifyWorkoutOfChange` enfileira.
    const fromAutomaticRelease: WorkoutProtocolChangedJob = { ...fromDashboard };
    await expect(worker.process({ data: fromDashboard } as never)).resolves.toEqual({
      status: 'OFFERED',
    });
    await worker.process({ data: fromAutomaticRelease } as never);
    expect(onProtocolChanged.mock.calls).toEqual([
      [USER_ID, 'SUBSTITUTION'],
      [USER_ID, 'SUBSTITUTION'],
    ]);
  });
});

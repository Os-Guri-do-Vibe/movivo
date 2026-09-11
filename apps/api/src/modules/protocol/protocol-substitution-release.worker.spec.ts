import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import type { ProtocolStructure } from '@movivo/shared';

import type { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import type { QueueManager } from '../jobs/queue-manager.service';
import type { WorkerFactory } from '../jobs/worker.factory';
import {
  ProtocolSubstitutionReleaseWorker,
  type ProtocolSubstitutionReleaseJob,
} from './protocol-substitution-release.worker';
import type { ProtocolRepository } from './protocol.repository';
import type {
  ProtocolSubstitutionRepository,
  ReleaseSubstitutionResult,
} from './protocol-substitution.repository';
import type { WorkoutPresentationService } from './workout-presentation.service';

const content: ProtocolStructure = {
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
          exerciseId: 'agachamento_goblet',
          name: 'Agachamento goblet',
          sets: 3,
          reps: { min: 8, max: 12 },
          loadStrategy: 'BODYWEIGHT',
          restSeconds: 60,
        },
      ],
    },
  ],
};

const personal = {
  name: 'Aluno Teste',
  birthDate: '1997-03-15',
  biologicalSex: 'MALE' as const,
  heightCm: 178,
  weightKg: 78,
  phoneNumber: '+5511999999999',
};

function makeWorker(
  released: boolean,
  version = 1,
  opts: {
    findLatestPersonalInfo?: () => Promise<typeof personal | null>;
    aiSummary?: string | undefined;
  } = {},
) {
  const workers = { create: vi.fn() } as unknown as WorkerFactory;
  const releaseResult: ReleaseSubstitutionResult = released
    ? {
        released: true,
        protocolId: 'p1',
        userId: 'u1',
        version,
        content,
        mesocycleName: 'Mesociclo 1: Adaptação',
        startDate: new Date('2026-08-22T00:00:00.000Z'),
        endDate: new Date('2026-11-14T00:00:00.000Z'),
        totalWeeks: 12,
        fromExerciseName: 'Flexão',
        toExerciseName: 'Supino Reto (Halter)',
      }
    : { released: false };
  const release = vi.fn(async () => releaseResult);
  const repository = { release } as unknown as ProtocolSubstitutionRepository;
  const findLatestPersonalInfo = vi.fn(opts.findLatestPersonalInfo ?? (async () => personal));
  const setPdfContent = vi.fn(async () => undefined);
  const protocolRepository = {
    findLatestPersonalInfo,
    setPdfContent,
  } as unknown as ProtocolRepository;
  const enqueue = vi.fn(async () => 'job');
  const queues = { enqueue } as unknown as QueueManager;
  const emit = vi.fn();
  const queueEvents = { emit } as unknown as DashboardQueueEventsService;
  const present = vi.fn(async () => opts.aiSummary);
  const workoutPresentation = { present } as unknown as WorkoutPresentationService;
  const logger = { info: vi.fn(), warn: vi.fn(), setContext: vi.fn() } as never;
  const worker = new ProtocolSubstitutionReleaseWorker(
    workers,
    queues,
    repository,
    protocolRepository,
    queueEvents,
    workoutPresentation,
    logger,
  );
  return {
    worker,
    workers,
    release,
    findLatestPersonalInfo,
    setPdfContent,
    enqueue,
    emit,
    present,
  };
}

function job(
  over: Partial<ProtocolSubstitutionReleaseJob> = {},
): Job<ProtocolSubstitutionReleaseJob> {
  return {
    data: { userId: 'u1', requestId: 'r1', ...over },
  } as Job<ProtocolSubstitutionReleaseJob>;
}

describe('ProtocolSubstitutionReleaseWorker (janela de cortesia de 30min da substituição)', () => {
  it('registra o worker na fila protocol-substitution-release', () => {
    const { worker, workers } = makeWorker(true);
    worker.onModuleInit();
    expect(workers.create).toHaveBeenCalledWith(
      'protocol-substitution-release',
      expect.any(Function),
    );
  });

  it('profissional não agiu em 30min → libera, entrega o protocolo inteiro e notifica o painel', async () => {
    const { worker, release, enqueue, emit } = makeWorker(true, 3);
    const res = await worker.process(job());
    expect(res.status).toBe('RELEASED');
    expect(release).toHaveBeenCalledWith({ userId: 'u1', role: 'USER' }, 'r1');
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'protocol-delivery',
      {
        userId: 'u1',
        protocolId: 'p1',
        protocolVersion: 3,
        type: 'PROTOCOL_DELIVERY',
        deliveryReason: 'SUBSTITUTION',
        substitutionFromExercise: 'Flexão',
        substitutionToExercise: 'Supino Reto (Halter)',
      },
      { jobId: 'substitution-delivery_u1_3' },
    );
    expect(emit).toHaveBeenCalledWith('protocol');
  });

  it('achado 2026-09-04: gera o resumo de IA e manda no payload da entrega', async () => {
    const { worker, present, enqueue } = makeWorker(true, 3, { aiSummary: 'Resumo do treino.' });
    await worker.process(job());
    // Achado 2026-09-08: reason/from/to distinguem a reentrega pós-substituição da 1ª
    // entrega, tanto pro resumo de IA (`WorkoutPresentationService`) quanto pra saudação
    // estática do worker de WhatsApp (`protocolDeliveryPdfText`).
    expect(present).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        biologicalSex: 'MALE',
        content,
        totalWeeks: 12,
        mesocycleName: 'Mesociclo 1: Adaptação',
        reason: 'SUBSTITUTION',
        substitutionFrom: 'Flexão',
        substitutionTo: 'Supino Reto (Halter)',
      }),
    );
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'protocol-delivery',
      expect.objectContaining({
        text: 'Resumo do treino.',
        deliveryReason: 'SUBSTITUTION',
        substitutionFromExercise: 'Flexão',
        substitutionToExercise: 'Supino Reto (Halter)',
      }),
      { jobId: 'substitution-delivery_u1_3' },
    );
  });

  it('já decidida ou protocolo mudou de versão → no-op, sem entrega', async () => {
    const { worker, enqueue, emit } = makeWorker(false);
    const res = await worker.process(job());
    expect(res.status).toBe('SKIPPED');
    expect(enqueue).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('gera e grava o PDF completo do protocolo ao auto-liberar a substituição', async () => {
    const { worker, findLatestPersonalInfo, setPdfContent } = makeWorker(true, 3);
    await worker.process(job());
    expect(findLatestPersonalInfo).toHaveBeenCalledWith('u1');
    expect(setPdfContent).toHaveBeenCalledWith('u1', 'p1', expect.any(Buffer));
  });

  it('falha ao gerar o PDF não bloqueia a liberação nem a entrega (cai pro texto+link)', async () => {
    const { worker, enqueue, setPdfContent } = makeWorker(true, 3, {
      findLatestPersonalInfo: async () => null,
    });
    const res = await worker.process(job());
    expect(res.status).toBe('RELEASED');
    // Achado 2026-09-09 (bug reportado pelo fundador): a coluna precisa ser explicitamente
    // limpa quando a regeneração falha — senão o PDF da versão ANTERIOR (já desatualizado
    // com a troca) fica salvo e `WhatsappOutboundWorker.buildDelivery` o trata como válido,
    // mandando um PDF que não reflete o protocolo atual em vez de cair no texto+link.
    expect(setPdfContent).toHaveBeenCalledWith('u1', 'p1', null);
    expect(enqueue).toHaveBeenCalledOnce();
  });
});

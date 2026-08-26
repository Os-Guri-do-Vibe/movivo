import type { Job } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import type { ProtocolStructure } from '@movivo/shared';

import type { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import type { QueueManager } from '../jobs/queue-manager.service';
import type { WorkerFactory } from '../jobs/worker.factory';
import {
  ProtocolAutoReleaseWorker,
  type ProtocolAutoReleaseJob,
} from './protocol-auto-release.worker';
import type { AutoReleaseResult, ProtocolRepository } from './protocol.repository';

const content: ProtocolStructure = {
  promptVersion: 'v1',
  goal: 'CONDITIONING',
  phase: 'ADAPTACAO',
  weeklyFrequency: 1,
  sessions: [
    {
      dayLabel: 'Dia 1',
      focus: 'Corpo inteiro',
      exercises: [
        {
          exerciseId: 'goblet_squat',
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
  opts: { findLatestPersonalInfo?: () => Promise<typeof personal | null> } = {},
) {
  const workers = { create: vi.fn() } as unknown as WorkerFactory;
  const releaseResult: AutoReleaseResult = released
    ? {
        released: true,
        version,
        content,
        mesocycleName: 'Mesociclo 1 — Adaptação',
        startDate: new Date('2026-08-22T00:00:00.000Z'),
        endDate: new Date('2026-11-14T00:00:00.000Z'),
        totalWeeks: 12,
        signatureHash: 'a'.repeat(64),
        signedAt: new Date('2026-08-22T00:00:00.000Z'),
      }
    : { released: false, version };
  const autoRelease = vi.fn(async () => releaseResult);
  const findLatestPersonalInfo = vi.fn(opts.findLatestPersonalInfo ?? (async () => personal));
  const setPdfContent = vi.fn(async () => undefined);
  const repository = {
    autoRelease,
    findLatestPersonalInfo,
    setPdfContent,
  } as unknown as ProtocolRepository;
  const enqueue = vi.fn(async () => 'job');
  const queues = { enqueue } as unknown as QueueManager;
  const emit = vi.fn();
  const queueEvents = { emit } as unknown as DashboardQueueEventsService;
  const logger = { info: vi.fn(), warn: vi.fn(), setContext: vi.fn() } as never;
  const worker = new ProtocolAutoReleaseWorker(workers, queues, repository, queueEvents, logger);
  return { worker, workers, autoRelease, findLatestPersonalInfo, setPdfContent, enqueue, emit };
}

function job(over: Partial<ProtocolAutoReleaseJob> = {}): Job<ProtocolAutoReleaseJob> {
  return { data: { userId: 'u1', protocolId: 'p1', ...over } } as Job<ProtocolAutoReleaseJob>;
}

describe('ProtocolAutoReleaseWorker (fila do profissional — "Disponível para Revisão")', () => {
  it('registra o worker na fila protocol-auto-release', () => {
    const { worker, workers } = makeWorker(true);
    worker.onModuleInit();
    expect(workers.create).toHaveBeenCalledWith('protocol-auto-release', expect.any(Function));
  });

  it('CREF não agiu em 1h → libera, entrega e notifica o painel', async () => {
    const { worker, autoRelease, enqueue, emit } = makeWorker(true, 3);
    const res = await worker.process(job());
    expect(res.status).toBe('RELEASED');
    expect(autoRelease).toHaveBeenCalledWith('u1', 'p1');
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'protocol-delivery',
      { userId: 'u1', protocolId: 'p1', protocolVersion: 3, type: 'PROTOCOL_DELIVERY' },
      { jobId: 'protocol-delivery_u1_3' },
    );
    expect(emit).toHaveBeenCalledWith('protocol');
  });

  it('CREF já agiu (ou virou MANDATORY) → no-op, sem entrega', async () => {
    const { worker, enqueue, emit } = makeWorker(false);
    const res = await worker.process(job());
    expect(res.status).toBe('SKIPPED');
    expect(enqueue).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  // Achado 2026-08-22 (decisão do fundador): todo protocolo que vira ACTIVE ganha PDF, não
  // só o assinado manualmente — inclusive o liberado pela janela de cortesia de 1h.
  it('gera e grava o PDF do protocolo ao auto-liberar', async () => {
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
    expect(setPdfContent).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledOnce();
  });
});

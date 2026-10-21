import { describe, expect, it, vi } from 'vitest';

import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { RedisKeyBuilder } from '../../core/redis';
import type { QueueManager } from '../jobs/queue-manager.service';
import type { WorkoutJournalService } from './workout-journal.service';
import {
  REFRESH_OFFER_DELAY_MS,
  REFRESH_OFFER_TTL_SECONDS,
  WorkoutRefreshOfferService,
} from './workout-refresh-offer.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
// 2026-10-20T14:00Z = 11:00 em São Paulo.
const MORNING = new Date('2026-10-20T14:00:00.000Z');

function make(options: {
  refreshed?: 'CHANGED' | 'UNCHANGED' | 'NONE';
  linkSent?: boolean;
  workoutStatus?: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | null;
  student?: Array<{ name: string; timezone: string }>;
  journalFails?: boolean;
}) {
  const db = {
    runAsSystem: vi.fn(
      async () => options.student ?? [{ name: 'Giovana Lima', timezone: 'America/Sao_Paulo' }],
    ),
  } as unknown as TenantDatabase;
  const journal = {
    refreshPlannedSession: vi.fn(async () => options.refreshed ?? 'CHANGED'),
    journal: vi.fn(async () => {
      if (options.journalFails) throw new Error('banco fora');
      return {
        workout:
          options.workoutStatus === null
            ? null
            : {
                id: 'w-1',
                status: options.workoutStatus ?? 'PLANNED',
                prescription: { focus: 'Costas e Bíceps' },
              },
      };
    }),
  } as unknown as WorkoutJournalService;
  const redis = {
    exists: vi.fn(async () => (options.linkSent === false ? 0 : 1)),
    set: vi.fn(async () => 'OK'),
  };
  const enqueue = vi.fn(async (..._args: unknown[]) => 'job');
  const warn = vi.fn();
  const service = new WorkoutRefreshOfferService(
    db,
    journal,
    { enqueue } as unknown as QueueManager,
    redis as never,
    {
      forUser: (id: string, ...p: string[]) => `u:${id}:${p.join(':')}`,
    } as unknown as RedisKeyBuilder,
    { setContext: vi.fn(), warn } as never,
  );
  return { service, journal, redis, enqueue, warn };
}

describe('WorkoutRefreshOfferService.onProtocolChanged', () => {
  it('Giovana: link das 04:00 já enviado, treino atualizado, ainda não treinou → pergunta se quer link novo', async () => {
    const { service, redis, enqueue } = make({});

    await expect(service.onProtocolChanged(USER_ID, 'SUBSTITUTION', MORNING)).resolves.toBe(
      'OFFERED',
    );

    expect(redis.set).toHaveBeenCalledWith(
      `u:${USER_ID}:workout-refresh:offer`,
      JSON.stringify({ date: '2026-10-20' }),
      'EX',
      REFRESH_OFFER_TTL_SECONDS,
    );
    const [queue, name, job, options] = enqueue.mock.calls[0] as unknown as [
      string,
      string,
      { userId: string; type: string; text: string; dedupeId: string },
      { delay: number; jobId: string },
    ];
    expect(queue).toBe('whatsapp-outbound');
    expect(name).toBe('workout-refresh-offer');
    expect(job.type).toBe('COACH_MESSAGE');
    // 11:00 em São Paulo: saudação do horário local.
    expect(job.text).toMatch(/^Bom dia, \*Giovana\*!/);
    expect(job.text).toContain('A troca de exercício que você pediu já foi aprovada');
    expect(job.text).toContain('*Costas e Bíceps*');
    expect(job.text).toContain('quer que eu te envie um novo check-in diário');
    // A pergunta espera a entrega do protocolo atualizado sair antes.
    expect(options.delay).toBe(REFRESH_OFFER_DELAY_MS);
    expect(options.jobId).toContain('workout-refresh-offer');
  });

  it('a saudação segue o horário local do aluno (tarde e noite)', async () => {
    const afternoon = await (async () => {
      const { service, enqueue } = make({});
      await service.onProtocolChanged(
        USER_ID,
        'SUBSTITUTION',
        new Date('2026-10-20T18:00:00.000Z'),
      );
      return (enqueue.mock.calls[0]?.[2] as { text: string }).text;
    })();
    const night = await (async () => {
      const { service, enqueue } = make({});
      await service.onProtocolChanged(
        USER_ID,
        'SUBSTITUTION',
        new Date('2026-10-20T23:30:00.000Z'),
      );
      return (enqueue.mock.calls[0]?.[2] as { text: string }).text;
    })();
    expect(afternoon).toMatch(/^Boa tarde,/);
    expect(night).toMatch(/^Boa noite,/);
  });

  it('emenda do profissional usa a copy do ajuste, não a da troca de exercício', async () => {
    const { service, enqueue } = make({});
    await service.onProtocolChanged(USER_ID, 'ADJUSTMENT', MORNING);
    const text = (enqueue.mock.calls[0]?.[2] as { text: string }).text;
    expect(text).toContain('O profissional CREF atualizou o seu treino de hoje');
    expect(text).not.toContain('A troca de exercício');
  });

  it('sem link enviado hoje, atualiza o treino em silêncio (não há link velho para trocar)', async () => {
    const { service, redis, enqueue } = make({ linkSent: false });
    await expect(service.onProtocolChanged(USER_ID, 'SUBSTITUTION', MORNING)).resolves.toBe(
      'UPDATED_SILENTLY',
    );
    expect(enqueue).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('quem já começou a treinar não recebe a pergunta', async () => {
    const { service, enqueue } = make({ workoutStatus: 'IN_PROGRESS' });
    await expect(service.onProtocolChanged(USER_ID, 'SUBSTITUTION', MORNING)).resolves.toBe(
      'UPDATED_SILENTLY',
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('treino de hoje sem alteração (ou sem treino): nada a fazer', async () => {
    for (const refreshed of ['UNCHANGED', 'NONE'] as const) {
      const { service, enqueue, journal } = make({ refreshed });
      await expect(service.onProtocolChanged(USER_ID, 'SUBSTITUTION', MORNING)).resolves.toBe(
        'NOT_NEEDED',
      );
      expect(enqueue).not.toHaveBeenCalled();
      expect(journal.journal).not.toHaveBeenCalled();
    }
  });

  it('aluno inexistente: nada a fazer', async () => {
    const { service } = make({ student: [] });
    await expect(service.onProtocolChanged(USER_ID, 'SUBSTITUTION', MORNING)).resolves.toBe(
      'NOT_NEEDED',
    );
  });

  it('nunca lança: falha vira aviso no log e a publicação do protocolo segue', async () => {
    const { service, warn } = make({ journalFails: true });
    await expect(service.onProtocolChanged(USER_ID, 'SUBSTITUTION', MORNING)).resolves.toBe(
      'NOT_NEEDED',
    );
    expect(warn).toHaveBeenCalled();
  });
});

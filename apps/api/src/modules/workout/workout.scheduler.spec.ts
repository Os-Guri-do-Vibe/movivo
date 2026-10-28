import { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../../core/config';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import type { RedisKeyBuilder } from '../../core/redis';
import type { FollowupService } from '../followup/followup.service';
import { QueueManager } from '../jobs/queue-manager.service';
import { WorkerFactory } from '../jobs/worker.factory';
import type { ShortLinkService } from '../short-link/short-link.service';
import type { AttendanceAlertService } from './attendance-alert.service';
import type { AskDecision, MissedWorkoutAskPolicy } from './missed-workout-ask.policy';
import type { TrainingAccessService } from '../training/training-access.service';
import type { WorkoutJournalService } from './workout-journal.service';
import { WorkoutScheduler } from './workout.scheduler';

const CONFIG = {
  whatsapp: { publicSiteUrl: 'https://movivo.test' },
} as unknown as AppConfigService;

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '99999999-9999-4999-8999-999999999999';
const FOLLOWUP_ID = '22222222-2222-4222-8222-222222222222';
// 07:00 UTC == 04:00 em America/Sao_Paulo (UTC-3).
const AT_FOUR = new Date('2026-08-10T07:00:00.000Z');

const ASK: AskDecision = {
  kind: 'ASK',
  subject: {
    subjectDate: '2026-08-09',
    focus: 'Costas e Bíceps',
    sessionKey: 'Dia A',
    workoutSessionId: null,
    protocolId: '33333333-3333-4333-8333-333333333333',
    when: 'ontem',
  },
};

interface Options {
  hasWorkout?: boolean;
  decision?: AskDecision | 'THROWS';
  reservedStatus?: string;
  decided?: boolean;
  extraStudent?: boolean;
  sweepFails?: boolean;
  /** A frequência do aluno abre alerta para o profissional CREF (`check` devolve um achado). */
  attendanceAlert?: boolean | 'THROWS';
}

// Achado 2026-09-10 (pedido do fundador): horário deixou de ser configurável por aluno — o
// link diário dispara sempre às 04:00 no fuso LOCAL do aluno (`users.timezone`). Só
// ter treino no dia continua variando por titular. Não existe opt-out: o link é o acompanhamento.
function makeScheduler(options: Options = {}) {
  const rows = [
    {
      userId: USER_ID,
      name: 'Pedro Teste',
      timezone: 'America/Sao_Paulo',
    },
    ...(options.extraStudent
      ? [
          {
            userId: OTHER_USER_ID,
            name: 'Ana',
            timezone: 'America/Sao_Paulo',
          },
        ]
      : []),
  ];
  const chain = { from: () => chain, innerJoin: () => chain, where: async () => rows };
  const db = {
    runAsSystem: vi.fn((cb: (value: unknown) => Promise<unknown>) =>
      cb({ selectDistinct: () => chain }),
    ),
  } as unknown as TenantDatabase;
  const enqueue = vi.fn(async () => 'job');
  const hasWorkout = options.hasWorkout ?? true;
  const journal = vi.fn(async (userId: string) => {
    if (userId === OTHER_USER_ID) throw new Error('banco indisponível');
    return {
      workout: hasWorkout
        ? {
            id: '22222222-2222-4222-8222-222222222222',
            prescription: { dayLabel: 'Dia A', focus: 'Pernas' },
          }
        : null,
    };
  });
  const create = vi.fn(async () => 'aB3xK9pQ');
  const decide = vi.fn(async () => {
    if (options.decision === 'THROWS') throw new Error('política indisponível');
    return options.decision ?? ({ kind: 'NONE', reason: 'NOT_MISSED' } as AskDecision);
  });
  const reserve = vi.fn(async () => ({
    id: FOLLOWUP_ID,
    status: options.reservedStatus ?? 'PENDING_SEND',
  }));
  const sweep = vi.fn(async () => {
    if (options.sweepFails) throw new Error('banco indisponível');
    return { expired: 0, notSent: 0 };
  });
  const check = vi.fn(async () => {
    if (options.attendanceAlert === 'THROWS') throw new Error('banco indisponível');
    return options.attendanceAlert
      ? { reason: 'FALTAS_SEGUIDAS', streak: 3, streakStart: '2026-08-06' }
      : null;
  });
  const redis = {
    exists: vi.fn(async () => (options.decided ? 1 : 0)),
    set: vi.fn(async () => 'OK'),
  };
  const keys = {
    forUser: vi.fn((userId: string, ...parts: string[]) => `u:${userId}:${parts.join(':')}`),
  } as unknown as RedisKeyBuilder;
  const warn = vi.fn();
  const scheduler = new WorkoutScheduler(
    {} as WorkerFactory,
    { enqueue } as unknown as QueueManager,
    db,
    {
      createMagicLink: vi.fn(async () => 'https://movivo.test/treino/acessar#token=secret'),
    } as unknown as TrainingAccessService,
    { journal } as unknown as WorkoutJournalService,
    { create } as unknown as ShortLinkService,
    CONFIG,
    { reserve, sweep } as unknown as FollowupService,
    { decide } as unknown as MissedWorkoutAskPolicy,
    { check } as unknown as AttendanceAlertService,
    redis as never,
    keys,
    { setContext: vi.fn(), info: vi.fn(), warn } as unknown as PinoLogger,
  );
  return { scheduler, enqueue, journal, create, decide, reserve, sweep, redis, warn, check };
}

const payloadOf = (enqueue: ReturnType<typeof makeScheduler>['enqueue'], call = 0) =>
  (enqueue.mock.calls[call] as unknown as [string, string, Record<string, unknown>, object])[2];

describe('WorkoutScheduler.scan', () => {
  it('envia o link às 04:00 no fuso local, com dedupe por titular e dia', async () => {
    const { scheduler, enqueue } = makeScheduler();
    const result = await scheduler.scan(AT_FOUR);
    expect(result).toMatchObject({ sent: 1, asked: 0 });
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'workout-daily-link',
      expect.objectContaining({ userId: USER_ID, type: 'WORKOUT_DAILY_LINK' }),
      { jobId: `wa-workout-link-${USER_ID}-2026-08-10` },
    );
  });

  it('encurta o magic link para /check-in/<código> no domínio da marca (achado 2026-09-12)', async () => {
    const { scheduler, enqueue, create } = makeScheduler();
    await scheduler.scan(AT_FOUR);

    expect(create).toHaveBeenCalledWith(
      'https://movivo.test/treino/acessar#token=secret',
      expect.any(Date),
    );
    const payload = payloadOf(enqueue);
    expect(payload.text).toContain('https://movivo.test/check-in/aB3xK9pQ');
    expect(payload.text).not.toContain('#token=secret');
  });

  it('abre a mensagem com o FOCO do treino do dia em negrito, nunca com o rótulo "Dia A"', async () => {
    const { scheduler, enqueue } = makeScheduler();
    await scheduler.scan(AT_FOUR);
    const text = payloadOf(enqueue).text as string;
    expect(text).toContain('Seu treino de hoje é *Pernas*,');
    expect(text).not.toContain('Dia A');
  });

  it('nao envia fora do horario fixo (04:00)', async () => {
    const { scheduler, enqueue } = makeScheduler();
    // 08:00 UTC == 05:00 em America/Sao_Paulo — não é 04:00.
    await scheduler.scan(new Date('2026-08-10T08:00:00.000Z'));
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('com force (execução manual) envia fora das 04:00, mantendo o dedupe por titular e dia', async () => {
    const { scheduler, enqueue } = makeScheduler();
    // 21:00 UTC == 18:00 em America/Sao_Paulo.
    const result = await scheduler.scan(new Date('2026-08-10T21:00:00.000Z'), { force: true });
    expect(result.sent).toBe(1);
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'workout-daily-link',
      expect.objectContaining({
        userId: USER_ID,
        type: 'WORKOUT_DAILY_LINK',
        dedupeId: 'workout-link-2026-08-10',
      }),
      { jobId: `wa-workout-link-${USER_ID}-2026-08-10` },
    );
  });

  it('nao envia nada em dia sem sessao prescrita, nem pergunta sobre o treino sem registro', async () => {
    const { scheduler, enqueue, decide, reserve } = makeScheduler({
      hasWorkout: false,
      decision: ASK,
    });
    await scheduler.scan(AT_FOUR);
    expect(enqueue).not.toHaveBeenCalled();
    expect(decide).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it('uma decisão do dia já tomada não é refeita (nem num "forçar" às 10:00)', async () => {
    const { scheduler, enqueue, journal } = makeScheduler({ decided: true, decision: ASK });
    await scheduler.scan(new Date('2026-08-10T13:00:00.000Z'), { force: true });
    expect(journal).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('lembra a decisão do dia só depois de enfileirar o envio', async () => {
    const { scheduler, enqueue, redis } = makeScheduler();
    await scheduler.scan(AT_FOUR);
    const enqueueOrder = enqueue.mock.invocationCallOrder[0] ?? Infinity;
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('2026-08-10'),
      '1',
      'EX',
      172_800,
    );
    expect(redis.set.mock.invocationCallOrder[0] ?? 0).toBeGreaterThan(enqueueOrder);
  });
});

describe('WorkoutScheduler.scan: pergunta sobre o treino sem registro dentro do link', () => {
  it('reserva a pendência e manda UMA mensagem com o link e a pergunta, com texto de reserva', async () => {
    const { scheduler, enqueue, reserve, decide } = makeScheduler({ decision: ASK });
    const result = await scheduler.scan(AT_FOUR);

    expect(result).toMatchObject({ sent: 1, asked: 1 });
    expect(decide).toHaveBeenCalledWith(USER_ID, '2026-08-10', 'America/Sao_Paulo', AT_FOUR);
    expect(reserve).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        kind: 'MISSED_WORKOUT',
        subjectDate: '2026-08-09',
        topicLabel: 'Costas e Bíceps',
      }),
      AT_FOUR,
    );
    expect(enqueue).toHaveBeenCalledTimes(1);
    const payload = payloadOf(enqueue);
    expect(payload).toMatchObject({ type: 'WORKOUT_DAILY_LINK', followupId: FOLLOWUP_ID });
    const text = payload.text as string;
    expect(text.indexOf('https://movivo.test/check-in/aB3xK9pQ')).toBeLessThan(
      text.indexOf('sem registro'),
    );
    expect(text).toContain('*Costas e Bíceps*');
    // O texto de reserva é o link simples: sai se a pergunta ficar obsoleta antes do envio.
    expect(payload.fallbackText).not.toContain('sem registro');
    expect(payload.fallbackText).toContain('Seu treino de hoje é *Pernas*');
    // O jobId do link não muda: a idempotência do envio continua a de sempre.
    expect(enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'workout-daily-link',
      expect.anything(),
      { jobId: `wa-workout-link-${USER_ID}-2026-08-10` },
    );
  });

  it('sem pergunta, o job é o link simples, sem followupId nem texto de reserva', async () => {
    const { scheduler, enqueue, reserve } = makeScheduler();
    await scheduler.scan(AT_FOUR);
    expect(reserve).not.toHaveBeenCalled();
    const payload = payloadOf(enqueue);
    expect(payload).not.toHaveProperty('followupId');
    expect(payload).not.toHaveProperty('fallbackText');
    expect(payload.text).not.toContain('sem registro');
  });

  it('erro ao decidir a pergunta nunca bloqueia o link', async () => {
    const { scheduler, enqueue, warn } = makeScheduler({ decision: 'THROWS' });
    const result = await scheduler.scan(AT_FOUR);
    expect(result).toMatchObject({ sent: 1, asked: 0 });
    expect(payloadOf(enqueue).text).not.toContain('sem registro');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'workout_missed_ask_decision_failed' }),
      expect.any(String),
    );
  });

  it('pendência que já não está PENDING_SEND (cancelada, enviada) vira link simples', async () => {
    for (const reservedStatus of ['CANCELLED', 'OPEN', 'NOT_SENT', 'EXPIRED']) {
      const { scheduler, enqueue } = makeScheduler({ decision: ASK, reservedStatus });
      const result = await scheduler.scan(AT_FOUR);
      expect(result).toMatchObject({ sent: 1, asked: 0 });
      expect(payloadOf(enqueue)).not.toHaveProperty('followupId');
      expect(payloadOf(enqueue).text).not.toContain('sem registro');
    }
  });

  it('quando o último treino sem registro não foi ontem, a copy usa o dia da semana', async () => {
    const { scheduler, enqueue } = makeScheduler({
      decision: { ...ASK, subject: { ...ASK.subject, when: 'sexta', subjectDate: '2026-08-07' } },
    });
    await scheduler.scan(AT_FOUR);
    const text = (payloadOf(enqueue).text as string).toLowerCase();
    expect(text).toContain('sexta');
    expect(text).not.toContain('ontem');
  });
});

describe('WorkoutScheduler.scan: robustez', () => {
  it('um aluno com erro não impede o link dos demais, e a varredura sinaliza para o retry', async () => {
    const { scheduler, enqueue, warn } = makeScheduler({ extraStudent: true });
    await expect(scheduler.scan(AT_FOUR)).rejects.toThrow(/1 aluno\(s\)/);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(payloadOf(enqueue)).toMatchObject({ userId: USER_ID });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'workout_scan_user_failed', userId: OTHER_USER_ID }),
      expect.any(String),
    );
  });

  it('expira pendências velhas só na virada da hora, sem nunca atrapalhar os links', async () => {
    const onTheHour = makeScheduler({ sweepFails: true });
    await expect(onTheHour.scheduler.scan(AT_FOUR)).resolves.toMatchObject({ sent: 1 });
    expect(onTheHour.sweep).toHaveBeenCalledTimes(1);
    expect(onTheHour.enqueue).toHaveBeenCalledTimes(1);

    const midHour = makeScheduler();
    await midHour.scheduler.scan(new Date('2026-08-10T07:17:00.000Z'));
    expect(midHour.sweep).not.toHaveBeenCalled();
  });
});

describe('WorkoutScheduler.scan: alerta de frequência para o profissional CREF', () => {
  it('avalia a frequência de cada aluno às 04:00, com a data local, e conta os alertas abertos', async () => {
    const { scheduler, check } = makeScheduler({ attendanceAlert: true });
    const result = await scheduler.scan(AT_FOUR);
    expect(check).toHaveBeenCalledWith(USER_ID, '2026-08-10', AT_FOUR);
    expect(result).toMatchObject({ alerted: 1, sent: 1 });
  });

  it('vale também quando hoje é descanso (sem link)', async () => {
    const { scheduler, check } = makeScheduler({ hasWorkout: false, attendanceAlert: true });
    await scheduler.scan(AT_FOUR);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('só às 04:00 locais, como o link', async () => {
    const { scheduler, check } = makeScheduler({ attendanceAlert: true });
    await scheduler.scan(new Date('2026-08-10T08:00:00.000Z'));
    expect(check).not.toHaveBeenCalled();
  });

  it('erro ao avaliar a frequência nunca bloqueia o link', async () => {
    const { scheduler, enqueue, warn } = makeScheduler({ attendanceAlert: 'THROWS' });
    const result = await scheduler.scan(AT_FOUR);
    expect(result).toMatchObject({ sent: 1, alerted: 0 });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'attendance_alert_failed' }),
      expect.any(String),
    );
  });
});

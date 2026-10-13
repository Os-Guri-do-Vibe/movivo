import { describe, expect, it, vi } from 'vitest';

import type { CoachAttendanceService } from '../../core/database/coach-attendance.service';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { FollowupService } from '../followup/followup.service';
import {
  type AskFacts,
  decideAsk,
  MAX_QUESTIONS_PER_WEEK,
  MissedWorkoutAskPolicy,
} from './missed-workout-ask.policy';
import type { WorkoutDayStatus, WorkoutJournalService } from './workout-journal.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const TZ = 'America/Sao_Paulo';

const MISSED: WorkoutDayStatus = {
  kind: 'MISSED',
  dayLabel: 'Dia A',
  focus: 'Costas e Bíceps',
  sessionKey: 'Dia A',
  workoutSessionId: null,
  protocolId: '33333333-3333-4333-8333-333333333333',
  weekdayName: 'segunda-feira',
};

const facts = (overrides: Partial<AskFacts> = {}): AskFacts => ({
  today: '2026-10-13',
  timezone: TZ,
  streak: { target: { date: '2026-10-12', status: MISSED }, streak: 1 },
  question: { hasOpen: false, deliveredLast7d: 0, lastDeliveredAt: null },
  paused: false,
  openPainAlert: false,
  wroteSinceTargetDay: false,
  ...overrides,
});

describe('decideAsk', () => {
  it('primeira falta, sem nenhuma barreira: pergunta sobre ontem', () => {
    expect(decideAsk(facts())).toEqual({
      kind: 'ASK',
      subject: {
        subjectDate: '2026-10-12',
        focus: 'Costas e Bíceps',
        sessionKey: 'Dia A',
        workoutSessionId: null,
        protocolId: MISSED.kind === 'MISSED' ? MISSED.protocolId : '',
        when: 'ontem',
      },
    });
  });

  it('se a última sessão prevista foi antes de ontem, chama pelo dia da semana', () => {
    // Hoje terça 13/10; sexta 09/10 foi a última sessão prevista (sáb e dom, descanso).
    const result = decideAsk(
      facts({ streak: { target: { date: '2026-10-09', status: MISSED }, streak: 1 } }),
    );
    expect(result).toMatchObject({ kind: 'ASK', subject: { when: 'sexta' } });
  });

  it.each([
    ['sem alvo', facts({ streak: { target: null, streak: 0 } }), 'NO_TARGET'],
    [
      'último treino concluído',
      facts({ streak: { target: { date: '2026-10-12', status: { kind: 'DONE' } }, streak: 0 } }),
      'NOT_MISSED',
    ],
    [
      'treino em andamento ontem',
      facts({
        streak: { target: { date: '2026-10-12', status: { kind: 'IN_PROGRESS' } }, streak: 0 },
      }),
      'NOT_MISSED',
    ],
    [
      'segunda falta seguida',
      facts({ streak: { target: { date: '2026-10-12', status: MISSED }, streak: 2 } }),
      'REPEATED_MISS',
    ],
    [
      'pergunta anterior ainda aberta',
      facts({ question: { hasOpen: true, deliveredLast7d: 1, lastDeliveredAt: null } }),
      'QUESTION_OPEN',
    ],
    [
      'teto semanal atingido',
      facts({
        question: {
          hasOpen: false,
          deliveredLast7d: MAX_QUESTIONS_PER_WEEK,
          lastDeliveredAt: new Date('2026-10-08T07:00:00Z'),
        },
      }),
      'WEEKLY_CAP',
    ],
    [
      'perguntou ontem de manhã',
      facts({
        question: {
          hasOpen: false,
          deliveredLast7d: 1,
          lastDeliveredAt: new Date('2026-10-12T07:00:00Z'),
        },
      }),
      'ASKED_YESTERDAY',
    ],
    ['atendimento pausado', facts({ paused: true }), 'PAUSED'],
    ['alerta de dor aberto', facts({ openPainAlert: true }), 'PAIN_ALERT'],
    ['aluno já escreveu', facts({ wroteSinceTargetDay: true }), 'ALREADY_WROTE'],
  ] as const)('não pergunta: %s', (_label, input, reason) => {
    expect(decideAsk(input)).toEqual({ kind: 'NONE', reason });
  });

  it('uma pergunta entregue há 2 dias (1 na semana) ainda permite perguntar', () => {
    const result = decideAsk(
      facts({
        question: {
          hasOpen: false,
          deliveredLast7d: 1,
          lastDeliveredAt: new Date('2026-10-11T07:00:00Z'),
        },
      }),
    );
    expect(result.kind).toBe('ASK');
  });

  it('a data de "ontem" da última pergunta usa o fuso do aluno', () => {
    // 02:00 UTC de 13/10 ainda é 12/10 em São Paulo: "ontem" para quem recebe hoje (13/10).
    const result = decideAsk(
      facts({
        question: {
          hasOpen: false,
          deliveredLast7d: 1,
          lastDeliveredAt: new Date('2026-10-13T02:00:00Z'),
        },
      }),
    );
    expect(result).toEqual({ kind: 'NONE', reason: 'ASKED_YESTERDAY' });
  });
});

function makePolicy(options: {
  streak?: Awaited<ReturnType<WorkoutJournalService['recentMissStreak']>>;
  hasOpen?: boolean;
  paused?: boolean;
  painRows?: unknown[];
  inboundRows?: unknown[];
}) {
  const recentMissStreak = vi.fn(
    async () => options.streak ?? { target: { date: '2026-10-12', status: MISSED }, streak: 1 },
  );
  const recentSummary = vi.fn(async () => ({
    hasOpen: options.hasOpen ?? false,
    deliveredLast7d: 0,
    lastDeliveredAt: null,
  }));
  const isPaused = vi.fn(async () => options.paused ?? false);
  const tables: unknown[][] = [options.painRows ?? [], options.inboundRows ?? []];
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {};
    for (const name of ['from', 'where']) c[name] = () => c;
    c.limit = async () => rows;
    return c;
  };
  const db = {
    runAsUser: vi.fn((_u: string, _r: string, cb: (tx: unknown) => Promise<unknown>) =>
      cb({ select: () => chain(tables.shift() ?? []) }),
    ),
  } as unknown as TenantDatabase;
  const policy = new MissedWorkoutAskPolicy(
    db,
    { recentMissStreak } as unknown as WorkoutJournalService,
    { recentSummary } as unknown as FollowupService,
    { isPaused } as unknown as CoachAttendanceService,
  );
  return { policy, recentMissStreak, recentSummary, isPaused, db };
}

describe('MissedWorkoutAskPolicy.decide', () => {
  const NOW = new Date('2026-10-13T07:00:00Z');

  it('carrega tudo e pergunta quando nenhuma guarda barra', async () => {
    const { policy } = makePolicy({});
    expect(await policy.decide(USER_ID, '2026-10-13', TZ, NOW)).toMatchObject({ kind: 'ASK' });
  });

  it('último treino concluído: sai logo, sem nenhuma consulta cara', async () => {
    const { policy, recentSummary, isPaused, db } = makePolicy({
      streak: { target: { date: '2026-10-12', status: { kind: 'DONE' } }, streak: 0 },
    });
    expect(await policy.decide(USER_ID, '2026-10-13', TZ, NOW)).toEqual({
      kind: 'NONE',
      reason: 'NOT_MISSED',
    });
    expect(recentSummary).not.toHaveBeenCalled();
    expect(isPaused).not.toHaveBeenCalled();
    expect(db.runAsUser).not.toHaveBeenCalled();
  });

  it('2ª falta seguida: sai logo (só o link)', async () => {
    const { policy, recentSummary } = makePolicy({
      streak: { target: { date: '2026-10-12', status: MISSED }, streak: 2 },
    });
    expect(await policy.decide(USER_ID, '2026-10-13', TZ, NOW)).toEqual({
      kind: 'NONE',
      reason: 'REPEATED_MISS',
    });
    expect(recentSummary).not.toHaveBeenCalled();
  });

  it('pergunta aberta: não consulta pausa, alerta nem mensagens', async () => {
    const { policy, isPaused, db } = makePolicy({ hasOpen: true });
    expect(await policy.decide(USER_ID, '2026-10-13', TZ, NOW)).toEqual({
      kind: 'NONE',
      reason: 'QUESTION_OPEN',
    });
    expect(isPaused).not.toHaveBeenCalled();
    expect(db.runAsUser).not.toHaveBeenCalled();
  });

  it('atendimento pausado, alerta de dor aberto e mensagem recente barram a pergunta', async () => {
    expect(
      await makePolicy({ paused: true }).policy.decide(USER_ID, '2026-10-13', TZ, NOW),
    ).toEqual({ kind: 'NONE', reason: 'PAUSED' });
    expect(
      await makePolicy({ painRows: [{ id: 'a1' }] }).policy.decide(USER_ID, '2026-10-13', TZ, NOW),
    ).toEqual({ kind: 'NONE', reason: 'PAIN_ALERT' });
    expect(
      await makePolicy({ inboundRows: [{ id: 'c1' }] }).policy.decide(
        USER_ID,
        '2026-10-13',
        TZ,
        NOW,
      ),
    ).toEqual({ kind: 'NONE', reason: 'ALREADY_WROTE' });
  });
});

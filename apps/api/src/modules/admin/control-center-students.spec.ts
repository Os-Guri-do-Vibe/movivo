/**
 * US-7.4 — ficha unificada, timeline única, adesão declarada, qualidade da IA por aluno
 * e risco de cancelamento. Arquivo separado do `control-center.service.spec.ts` porque
 * o pilar Alunos tem sua própria montagem de fixture (10 `select` em ordem).
 */
import { describe, expect, it, vi } from 'vitest';

import type { AgentConfigRepository } from '../../core/agent-config/agent-config.repository';
import type { DatabaseHealthService } from '../../core/database';
import type { HealthCipherService } from '../../core/database/health-cipher.service';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import { RedisKeyBuilder, type RedisHealthService } from '../../core/redis';
import type { Redis } from 'ioredis';
import type { AuditService } from './audit.service';
import { assessChurnRisk, CHURN_RISK_THRESHOLDS } from './churn-risk';
import { ControlCenterService } from './control-center.service';

function query(rows: unknown[]) {
  const chain = {
    from: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    groupBy: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(rows),
    then: <T1 = unknown[], T2 = never>(
      onfulfilled?: ((value: unknown[]) => T1 | PromiseLike<T1>) | null,
      onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
    ) => Promise.resolve(rows).then(onfulfilled, onrejected),
  };
  return chain;
}

const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const ACTOR = { userId: '22222222-2222-4222-8222-222222222222', jti: 'j1' } as const;

function build(...results: unknown[][]) {
  const select = vi.fn();
  for (const rows of results) select.mockImplementationOnce(() => query(rows));
  const tx = { select };
  const db = {
    runAsSystem: vi.fn((cb: (value: unknown) => Promise<unknown>) => cb(tx)),
    runAsUser: vi.fn((_id: string, _role: string, cb: (value: unknown) => Promise<unknown>) =>
      cb(tx),
    ),
  } as unknown as TenantDatabase;
  const audit = { append: vi.fn().mockResolvedValue(undefined) };
  const decryptHealth = vi.fn().mockResolvedValue(
    JSON.stringify({
      fatigue: 'ADEQUADO',
      workouts: 'TRES_MAIS',
      adjustment: 'MANTER',
      painReport: 'desconforto leve no ombro',
    }),
  );
  const service = new ControlCenterService(
    db,
    { ping: vi.fn() } as unknown as DatabaseHealthService,
    { ping: vi.fn() } as unknown as RedisHealthService,
    audit as unknown as AuditService,
    { decryptHealth } as unknown as HealthCipherService,
    { mget: vi.fn().mockResolvedValue([]) } as unknown as Redis,
    new RedisKeyBuilder('movivo'),
    { activePayload: vi.fn().mockResolvedValue(null) } as unknown as AgentConfigRepository,
  );
  return { service, db, audit, decryptHealth };
}

const now = new Date('2026-08-12T12:00:00.000Z');
const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000);

/** Aluno-fixture completo: as 6 origens da timeline com evento em cada uma. */
function studentResults() {
  return [
    [
      {
        id: STUDENT_ID,
        name: 'Ana Souza',
        email: 'ana@teste.com',
        phoneNumber: '+5511999990001',
        status: 'ACTIVE',
        requiresProfessionalReview: false,
        subscriptionStatus: 'TRIALING',
        protocolStatus: 'ACTIVE',
        anamnesisStatus: 'COMPLETED',
        parqState: 'CLEARED',
        routine: null,
        lastInboundAt: day(-9),
        unansweredCheckinSentAt: day(-4),
        renewalAt: day(2),
      },
    ],
    [
      {
        id: '33333333-3333-4333-8333-333333333333',
        version: 2,
        currentWeek: 3,
        totalWeeks: 8,
        signedAt: day(-11),
      },
    ],
    [{ createdAt: day(-24), submittedAt: day(-23), status: 'COMPLETED' }],
    [
      {
        createdAt: day(-11),
        version: 2,
        changeReason: 'ajuste pós check-in',
        generatedBy: 'gpt-4.1',
        signedAt: day(-11),
      },
    ],
    [
      {
        weekNumber: 3,
        sentAt: day(-4),
        respondedAt: day(-3),
        completedAt: day(-3),
        responsesCipher: Buffer.from('cipher'),
      },
    ],
    [
      {
        createdAt: day(-22),
        plan: 'MONTHLY',
        status: 'TRIALING',
        trialEndsAt: day(2),
        currentPeriodStart: null,
        canceledAt: null,
        cancelReason: null,
      },
    ],
    [
      {
        createdAt: day(-2),
        updatedAt: day(-1),
        level: 'ALERT',
        reason: 'VALIDATOR_FLAG',
        status: 'RESOLVED',
      },
    ],
    [{ day: '2026-08-06', total: 12 }],
    [{ createdAt: day(-5), content: 'Fala com a Ana Souza no +5511999990001' }],
    [{ blocked: 1, validated: 20 }],
  ];
}

describe('ControlCenterService.student — ficha unificada (US-7.4)', () => {
  it('mescla as 6 origens numa timeline única e ordenada, com adesão declarada', async () => {
    const { service } = build(...studentResults());

    const { data } = await service.student({ ...ACTOR, role: 'PROFESSIONAL' }, STUDENT_ID);
    const { timeline } = data.student;

    expect(new Set(timeline.map((event) => event.kind))).toEqual(
      new Set(['ANAMNESIS', 'PROTOCOL', 'CHECKIN', 'CONVERSATION', 'SUBSCRIPTION', 'HANDOFF']),
    );
    expect(timeline.map((event) => event.at)).toEqual(
      [...timeline.map((event) => event.at)].sort().reverse(),
    );
    expect(timeline.some((event) => event.title === 'Atendimento humano resolvido')).toBe(true);
    expect(timeline.some((event) => event.title === '12 mensagens trocadas no dia')).toBe(true);
    expect(data.student.adherence).toMatchObject({ checkinsSent: 1, checkinsResponded: 1 });
    expect(data.student.adherence.responseRate).toMatchObject({ value: 100, status: 'PROXY' });
    expect(data.student.adherence.responseRate.definition).toContain('workout_completions');
    // North Star continua indisponível, nunca zero.
    expect(data.student.workoutHistory.status).toBe('UNAVAILABLE');
  });

  it('decifra a evolução declarada e anonimiza a ocorrência de resposta bloqueada', async () => {
    const { service, decryptHealth } = build(...studentResults());

    const { data } = await service.student({ ...ACTOR, role: 'PROFESSIONAL' }, STUDENT_ID);

    expect(decryptHealth).toHaveBeenCalledTimes(1);
    expect(data.student.health?.evolution).toEqual([
      expect.objectContaining({ week: 3, fatigue: 'ADEQUADO', workouts: 'TRES_MAIS' }),
    ]);
    expect(data.student.health?.painReports).toHaveLength(1);
    expect(data.student.health?.parqState).toBe('CLEARED');
    expect(data.student.aiQuality.blockedRate.value).toBe(5);
    const [occurrence] = data.student.aiQuality.occurrences;
    expect(occurrence?.content).not.toContain('Ana Souza');
    expect(occurrence?.content).not.toContain('+5511999990001');
  });

  it('sem STUDENTS_HEALTH_READ o payload não carrega nenhum campo de saúde', async () => {
    const { service, decryptHealth } = build(...studentResults());

    const { data } = await service.student({ ...ACTOR, role: 'SUPPORT' }, STUDENT_ID);

    expect(data.student.health).toBeNull();
    // O ciphertext nem chega a ser aberto.
    expect(decryptHealth).not.toHaveBeenCalled();
    expect(data.student.aiQuality.occurrences).toEqual([]);
    expect(JSON.stringify(data)).not.toMatch(/parq|dor|desconforto|ADEQUADO|painReport/i);
    // A ficha continua existindo: timeline e adesão são dado operacional.
    expect(data.student.timeline.length).toBeGreaterThan(0);
  });

  it('não usa termo clínico nem promessa de resultado em nenhum texto do payload', async () => {
    const { service } = build(...studentResults());

    const response = await service.student({ ...ACTOR, role: 'PROFESSIONAL' }, STUDENT_ID);

    expect(JSON.stringify(response)).not.toMatch(
      /diagn[óo]stic|tratamento|quadro cl[íi]nic|resultado garantido/i,
    );
  });
});

describe('ControlCenterService.students — risco de cancelamento', () => {
  it('ordena por risco e nomeia os sinais de cada aluno', async () => {
    const { service } = build(
      [
        {
          id: STUDENT_ID,
          name: 'Sem risco',
          email: null,
          phoneNumber: '+5511999990002',
          status: 'ACTIVE',
          subscriptionStatus: 'ACTIVE',
          protocolStatus: 'ACTIVE',
          lastInboundAt: new Date(),
          unansweredCheckinSentAt: null,
          renewalAt: null,
        },
        {
          id: '44444444-4444-4444-8444-444444444444',
          name: 'Em risco',
          email: null,
          phoneNumber: '+5511999990003',
          status: 'ACTIVE',
          subscriptionStatus: 'TRIALING',
          protocolStatus: 'ACTIVE',
          lastInboundAt: new Date(Date.now() - 20 * 86_400_000),
          unansweredCheckinSentAt: new Date(Date.now() - 10 * 86_400_000),
          renewalAt: new Date(Date.now() + 86_400_000),
        },
      ],
      [{ blocked: 2, validated: 100 }],
    );

    const { data } = await service.students({ ...ACTOR, role: 'SUPPORT' });

    expect(data.students.map((student) => student.name)).toEqual(['Em risco', 'Sem risco']);
    expect(data.students[0]?.churnRisk.score).toBe(3);
    expect(data.students[0]?.churnRisk.signals.map((signal) => signal.code)).toEqual([
      'SEM_MENSAGEM',
      'CHECKIN_SEM_RESPOSTA',
      'RENOVACAO_PROXIMA',
    ]);
    expect(data.students[1]?.churnRisk).toEqual({ score: 0, signals: [] });
    expect(data.aiBlockedRate.value).toBe(2);
    // Nenhum campo de saúde na lista.
    expect(JSON.stringify(data)).not.toMatch(/parq|anamnes|painReport|fatigue|desconforto/i);
  });
});

describe('assessChurnRisk', () => {
  it('só dispara sinal a partir do limiar, e nunca inventa sinal sem dado', () => {
    const base = { lastInboundAt: null, unansweredCheckinSentAt: null, renewalAt: null };
    expect(assessChurnRisk(base, now.getTime())).toEqual({ score: 0, signals: [] });

    const belowThreshold = assessChurnRisk(
      {
        lastInboundAt: day(-(CHURN_RISK_THRESHOLDS.silentDays - 1)),
        unansweredCheckinSentAt: day(-(CHURN_RISK_THRESHOLDS.unansweredCheckinDays - 1)),
        renewalAt: day(CHURN_RISK_THRESHOLDS.renewalWindowDays + 1),
      },
      now.getTime(),
    );
    expect(belowThreshold.score).toBe(0);

    const atThreshold = assessChurnRisk(
      {
        lastInboundAt: day(-CHURN_RISK_THRESHOLDS.silentDays),
        unansweredCheckinSentAt: day(-CHURN_RISK_THRESHOLDS.unansweredCheckinDays),
        renewalAt: day(CHURN_RISK_THRESHOLDS.renewalWindowDays),
      },
      now.getTime(),
    );
    expect(atThreshold.score).toBe(3);
  });

  it('ignora renovação já vencida — o sinal é sobre o que ainda vai vencer', () => {
    const risk = assessChurnRisk(
      { lastInboundAt: null, unansweredCheckinSentAt: null, renewalAt: day(-1) },
      now.getTime(),
    );
    expect(risk.signals).toEqual([]);
  });
});

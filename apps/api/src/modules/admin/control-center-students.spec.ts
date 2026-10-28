/**
 * US-7.4 — ficha unificada, timeline única, adesão verificada e declarada, qualidade da IA por aluno
 * e risco de cancelamento. Arquivo separado do `control-center.service.spec.ts` porque
 * o pilar Alunos tem sua própria montagem de fixture (um `select` por consulta, em ordem).
 */
import { describe, expect, it, vi } from 'vitest';

import type { DatabaseHealthService } from '../../core/database';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { RedisHealthService } from '../../core/redis';
import type { AuditService } from './audit.service';
import { assessChurnRisk, CHURN_RISK_THRESHOLDS } from './churn-risk';
import { ControlCenterService } from './control-center.service';
import type { EvolutionTransport } from '../whatsapp/evolution-transport';

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

/**
 * Fila de retornos de `tx.execute` (SQL cru). A North Star (US-8.1) sai de um `execute`,
 * não do query builder; por padrão a fila é vazia e a métrica fica indisponível, que é o
 * que a maioria dos testes desta suíte espera.
 */
let nextExecuteRows: unknown[][] = [];
function withExecute(...rows: unknown[][]) {
  nextExecuteRows = rows;
}

function build(...results: unknown[][]) {
  const select = vi.fn();
  for (const rows of results) select.mockImplementationOnce(() => query(rows));
  // US-8.1: North Star/adesão declarada rodam DEPOIS dos selects enumerados; um
  // fallback vazio evita reenumerar todas as queries em cada teste desta suíte.
  select.mockImplementation(() => query([]));
  const executeQueue = [...nextExecuteRows];
  nextExecuteRows = [];
  const tx = { select, execute: vi.fn(async () => executeQueue.shift() ?? []) };
  const db = {
    runAsSystem: vi.fn((cb: (value: unknown) => Promise<unknown>) => cb(tx)),
    runAsUser: vi.fn((_id: string, _role: string, cb: (value: unknown) => Promise<unknown>) =>
      cb(tx),
    ),
  } as unknown as TenantDatabase;
  const audit = { append: vi.fn().mockResolvedValue(undefined) };
  const service = new ControlCenterService(
    db,
    { ping: vi.fn() } as unknown as DatabaseHealthService,
    { ping: vi.fn() } as unknown as RedisHealthService,
    audit as unknown as AuditService,
    { hasCredentials: () => false } as unknown as EvolutionTransport,
  );
  return { service, db, audit, select };
}

const now = new Date('2026-08-12T12:00:00.000Z');
const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000);

/**
 * Aluno-fixture completo, na ordem em que `student()` consulta o banco. Os blocos de saúde
 * (casos da fila, decisões e ritmo da conversa) só existem para quem lê saúde.
 */
function studentResults(withHealth: boolean) {
  const base = [
    [
      {
        id: STUDENT_ID,
        name: 'Ana Souza',
        email: 'ana@teste.com',
        phoneNumber: '+5511999990001',
        status: 'ACTIVE',
        subscriptionStatus: 'TRIALING',
        subscriptionPlan: 'MONTHLY',
        planStatus: 'ACTIVE',
        anamnesisStatus: 'COMPLETED',
        parqState: 'CLEARED',
        lastInboundAt: day(-9),
        unansweredCheckinSentAt: day(-4),
        renewalAt: day(2),
      },
    ],
    [{ createdAt: day(-24), submittedAt: day(-23), status: 'COMPLETED', firstTouchAt: null }],
    [{ version: 2, publishedAt: day(-11) }],
    [{ version: 1, publishedAt: day(-11) }],
    [{ declared: { primary: 'FAT_LOSS' }, strategy: { title: 'Perda de gordura com força' } }],
    [{ planned: 10, done: 7 }],
    [{ sent: 4, answered: 3 }],
    [
      {
        id: '33333333-3333-4333-8333-333333333333',
        performedOn: '2026-08-10',
        modality: 'STRENGTH',
        status: 'COMPLETED',
        rpe: 7,
        durationMinutes: 45,
        painReports: [{ region: 'KNEE', intensity: 4 }],
        finishedAt: day(-2),
      },
    ],
  ];
  const health = withHealth
    ? [
        [
          {
            id: '55555555-5555-4555-8555-555555555555',
            kind: 'SAFETY',
            priority: 'HIGH',
            domain: 'TRAINING',
            status: 'OPEN',
            summary: 'Sinal de segurança: SEVERE_PAIN (URGENT).',
            createdAt: day(-1),
            resolvedAt: null,
          },
        ],
        [
          {
            action: 'ADJUST_WEEKLY_VOLUME',
            verdict: 'EXECUTE',
            decidedBy: 'POLICY_ENGINE',
            createdAt: day(-3),
          },
        ],
      ]
    : [];
  const rest = [
    [{ answeredAt: day(-3) }],
    [
      {
        createdAt: day(-22),
        plan: 'MONTHLY',
        status: 'TRIALING',
        trialEndsAt: day(2),
        currentPeriodStart: null,
        canceledAt: null,
      },
    ],
    [{ blocked: 1, validated: 20 }],
  ];
  const conversation = withHealth ? [[{ day: '2026-08-06', messages: 12, at: day(-5) }]] : [];
  return [...base, ...health, ...rest, ...conversation];
}

describe('ControlCenterService.student — ficha unificada', () => {
  it('mescla as origens numa timeline única e ordenada, com adesão verificada e declarada', async () => {
    const { service } = build(...studentResults(true));

    const { data } = await service.student({ ...ACTOR, role: 'PROFESSIONAL' }, STUDENT_ID);
    const { timeline } = data.student;

    expect(new Set(timeline.map((event) => event.kind))).toEqual(
      new Set([
        'ANAMNESIS',
        'PLAN',
        'TRAINING',
        'CHECKIN',
        'CONVERSATION',
        'SUBSCRIPTION',
        'EXCEPTION',
      ]),
    );
    expect(timeline.map((event) => event.at)).toEqual(
      [...timeline.map((event) => event.at)].sort().reverse(),
    );
    // O servidor manda código + parâmetros crus; a frase é da tela.
    expect(timeline).toContainEqual(
      expect.objectContaining({ code: 'CONVERSATION_DAY', params: { messages: 12 } }),
    );
    expect(timeline).toContainEqual(
      expect.objectContaining({
        code: 'SUBSCRIPTION_CREATED',
        params: { plan: 'MONTHLY', status: 'TRIALING' },
      }),
    );
    expect(JSON.stringify(timeline)).not.toMatch(/"title"|"detail"/);
    expect(data.student.adherence).toMatchObject({ windowDays: 28, planned: 10, done: 7 });
    expect(data.student.adherence.rate).toMatchObject({ value: 70, status: 'AVAILABLE' });
    expect(data.student.checkins).toMatchObject({ sent: 4, answered: 3 });
    expect(data.student.checkins.responseRate).toMatchObject({ value: 75 });
    expect(data.student.plan).toMatchObject({
      training: { version: 2 },
      nutrition: { version: 1 },
      strategy: 'Perda de gordura com força',
      goal: 'FAT_LOSS',
    });
  });

  it('quem lê saúde recebe dor, casos da fila e decisões, e a leitura é auditada', async () => {
    const { service, audit } = build(...studentResults(true));

    const { data } = await service.student({ ...ACTOR, role: 'PROFESSIONAL' }, STUDENT_ID);

    expect(data.student.health?.parqState).toBe('CLEARED');
    expect(data.student.health?.painReports).toEqual([
      expect.objectContaining({ text: 'KNEE: 4/10' }),
    ]);
    expect(data.student.exceptions).toHaveLength(1);
    expect(data.student.decisions).toEqual([
      expect.objectContaining({ action: 'ADJUST_WEEKLY_VOLUME', decidedBy: 'POLICY_ENGINE' }),
    ]);
    expect(data.student.aiQuality.blockedRate.value).toBe(5);
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'STUDENT_DETAIL_VIEWED_WITH_HEALTH' }),
    );
  });

  it('sem STUDENTS_HEALTH_READ o payload não carrega nenhum campo de saúde', async () => {
    const { service } = build(...studentResults(false));

    const { data } = await service.student({ ...ACTOR, role: 'SUPPORT' }, STUDENT_ID);

    expect(data.student.health).toBeNull();
    expect(data.student.exceptions).toEqual([]);
    expect(data.student.decisions).toEqual([]);
    expect(data.student.timeline.some((event) => event.code === 'EXCEPTION_OPENED')).toBe(false);
    expect(data.student.timeline.some((event) => event.code === 'CONVERSATION_DAY')).toBe(false);
    // A ficha continua existindo: plano, adesão e assinatura são dado operacional.
    expect(data.student.timeline.length).toBeGreaterThan(0);
    expect(data.student.plan.training).not.toBeNull();
  });

  /**
   * Sprint 11 — condição sob a qual o Sato aprovou denormalizar `biological_sex` em `users`.
   *
   * A RLS de `users` é tudo-ou-nada por linha: a barreira real contra um papel interno ver
   * um campo que não precisa ver é a **projeção explícita** de cada query. O teste afirma
   * sobre as projeções de fato pedidas ao banco (chave do objeto E nome da coluna), não
   * sobre o JSON de saída — assim ele pega também o caso de alguém selecionar a coluna e
   * "só" não devolvê-la, que já a traria para dentro do processo e dos logs de query.
   */
  it('nenhuma projeção do pilar Alunos seleciona `biological_sex`', async () => {
    const { service, select } = build(...studentResults(false));
    await service.student({ ...ACTOR, role: 'SUPPORT' }, STUDENT_ID);

    const projections = select.mock.calls.flatMap((call: unknown[]) =>
      call[0] && typeof call[0] === 'object' ? [call[0] as Record<string, unknown>] : [],
    );
    expect(projections.length).toBeGreaterThan(0);
    for (const projection of projections) {
      expect(Object.keys(projection)).not.toContain('biologicalSex');
      for (const column of Object.values(projection)) {
        const name = (column as { name?: unknown })?.name;
        if (typeof name === 'string') expect(name).not.toBe('biological_sex');
      }
    }
  });

  it('não usa termo clínico nem promessa de resultado em nenhum texto do payload', async () => {
    const { service } = build(...studentResults(true));

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
          planStatus: 'ACTIVE',
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
          planStatus: 'ACTIVE',
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

  /** Mesmo contrato de projeção do `student()` — ver a justificativa lá. */
  it('a lista de alunos também não seleciona `biological_sex`', async () => {
    const { service, select } = build([], [{ blocked: 0, validated: 0 }]);
    await service.students({ ...ACTOR, role: 'SUPPORT' });

    for (const call of select.mock.calls as unknown[][]) {
      const projection = call[0];
      if (!projection || typeof projection !== 'object') continue;
      expect(Object.keys(projection as Record<string, unknown>)).not.toContain('biologicalSex');
    }
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

/**
 * TASK-8.9.4 — conferência numérica da North Star com tolerância 0. A US-8.1 provou o
 * caminho da coorte vazia ("indisponível, nunca zero"); o que faltava era a aritmética
 * com coorte povoada, que é o número que o fundador vai ler.
 */
describe('ControlCenterService.students — North Star (US-8.1 / TASK-8.9.4)', () => {
  it('média e taxa de reporte conferem com o cálculo manual, sem tolerância', async () => {
    withExecute(
      [{ cohort_size: 4, total_completions: 26, reporting: 3 }],
      [
        { source: 'LINK', completions: 14 },
        { source: 'FIT_FILE', completions: 9 },
        { source: 'WHATSAPP_SCREENSHOT', completions: 3 },
      ],
    );
    const { service } = build([], [{ blocked: 0, validated: 0 }]);

    const { data } = await service.students({ ...ACTOR, role: 'PROFESSIONAL' });

    // Cálculo manual, fora do código de produção: 26 ÷ 4 = 6,5 treinos.
    expect(data.northStar.averageCompletions.value).toBe(6.5);
    expect(data.northStar.averageCompletions.status).toBe('AVAILABLE');
    // 3 de 4 alunos com ao menos 1 treino = 75,0%.
    expect(data.northStar.reportingRate.value).toBe(75);
    expect(data.northStar.cohortSize).toBe(4);
    expect(data.northStar.target).toBe(8);
    // As fontes somam o total: nenhum treino é contado duas vezes nem some.
    expect(data.northStar.bySource).toEqual([
      { source: 'LINK', completions: 14 },
      { source: 'WHATSAPP_TEXT', completions: 0 },
      { source: 'WHATSAPP_SCREENSHOT', completions: 3 },
      { source: 'FIT_FILE', completions: 9 },
      { source: 'GPX_FILE', completions: 0 },
      { source: 'STAFF', completions: 0 },
    ]);
    expect(data.northStar.bySource.reduce((sum, row) => sum + row.completions, 0)).toBe(26);
  });

  it('coorte paga vazia deixa a North Star indisponível, nunca zero', async () => {
    withExecute([{ cohort_size: 0, total_completions: 0, reporting: 0 }], []);
    const { service } = build([], [{ blocked: 0, validated: 0 }]);

    const { data } = await service.students({ ...ACTOR, role: 'PROFESSIONAL' });

    expect(data.northStar.averageCompletions).toMatchObject({ value: null, status: 'UNAVAILABLE' });
    expect(data.northStar.reportingRate).toMatchObject({ value: null, status: 'UNAVAILABLE' });
    expect(data.northStar.cohortSize).toBe(0);
  });
});

import type {
  ControlCenterFinanceResponse,
  ControlCenterMarketingResponse,
  ControlCenterMetric,
  ControlCenterStudentsResponse,
  ControlCenterSystemResponse,
} from '@movivo/shared';
import {
  controlCenterCampaignsResponseSchema,
  controlCenterMarketingResponseSchema,
} from '@movivo/shared';
import { getTableName, isTable } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import type { AgentConfigRepository } from '../../core/agent-config/agent-config.repository';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { DatabaseHealthService } from '../../core/database';
import type { RedisHealthService } from '../../core/redis';
import type { Redis } from 'ioredis';

import type { HealthCipherService } from '../../core/database/health-cipher.service';
import { RedisKeyBuilder } from '../../core/redis';
import type { AuditService } from './audit.service';
import { ControlCenterService } from './control-center.service';

/**
 * Tabelas alcançadas por `.from(...)` desde o último `serviceWithSystemResults`. Existe
 * para a regra anti-dupla-contagem da TASK-8.9.4: `finance()` não pode ler `ad_spend`.
 */
const touchedTables: string[] = [];

function query(rows: unknown[]) {
  const chain = {
    from: (table?: unknown) => {
      if (isTable(table)) touchedTables.push(getTableName(table));
      return chain;
    },
    leftJoin: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    groupBy: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(rows),
    then: <TResult1 = unknown[], TResult2 = never>(
      onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise.resolve(rows).then(onfulfilled, onrejected),
  };
  return chain;
}

const ACTOR = {
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'SUPPORT',
  jti: 'j1',
} as const;

/**
 * Fila de retornos de `tx.execute` (SQL cru). Desde a US-8.4 o custo de IA por modelo sai
 * do query builder (precisa de LATERAL contra `model_pricing`), então a fixture do
 * financeiro precisa alimentar `execute`, não `select`. Consumida em ordem por
 * `serviceWithSystemResults`; `withExecute` a preenche antes de instanciar o serviço.
 */
let nextExecuteRows: unknown[][] = [];
function withExecute(...rows: unknown[][]) {
  nextExecuteRows = rows;
}

function serviceWithSystemResults(...results: unknown[][]) {
  const select = vi.fn();
  for (const rows of results) select.mockImplementationOnce(() => query(rows));
  // US-8.1: North Star/adesão declarada rodam DEPOIS dos selects enumerados; um
  // fallback vazio evita reenumerar todas as queries em cada teste desta suíte.
  select.mockImplementation(() => query([]));
  const executeQueue = [...nextExecuteRows];
  nextExecuteRows = [];
  touchedTables.length = 0;
  const tx = { select, execute: vi.fn(async () => executeQueue.shift() ?? []) };
  const db = {
    runAsSystem: vi.fn((callback: (value: unknown) => Promise<unknown>) => callback(tx)),
    runAsUser: vi.fn((_id: string, _role: string, callback: (value: unknown) => Promise<unknown>) =>
      callback(tx),
    ),
  } as unknown as TenantDatabase;
  const audit = { append: vi.fn().mockResolvedValue(undefined) };
  const service = new ControlCenterService(
    db,
    { ping: vi.fn().mockResolvedValue({ latencyMs: 2 }) } as unknown as DatabaseHealthService,
    { ping: vi.fn().mockResolvedValue({ latencyMs: 3 }) } as unknown as RedisHealthService,
    audit as unknown as AuditService,
    { decryptJson: vi.fn().mockReturnValue(null) } as unknown as HealthCipherService,
    { mget: vi.fn().mockResolvedValue([]) } as unknown as Redis,
    new RedisKeyBuilder('movivo'),
    { activePayload: vi.fn().mockResolvedValue(null) } as unknown as AgentConfigRepository,
  );
  return { service, db, audit };
}

const META = {
  generatedAt: new Date().toISOString(),
  timezone: 'America/Sao_Paulo' as const,
  dataQuality: [] as string[],
};

function metric(
  value: number | null,
  overrides: Partial<ControlCenterMetric> = {},
): ControlCenterMetric {
  return {
    value,
    unit: 'COUNT',
    status: value === null ? 'UNAVAILABLE' : 'AVAILABLE',
    definition: '',
    ...overrides,
  };
}

/**
 * `overview()` (US-7.8) é uma composição dos pilares — cada um já testado nas próprias
 * suítes (finance/marketing/students/system). Testar a agregação/gating aqui via
 * `vi.spyOn` nos métodos públicos evita reencenar a cadeia de `select` de cada pilar.
 */
function stubPillar<K extends 'students' | 'finance' | 'marketing' | 'system'>(
  service: ControlCenterService,
  method: K,
  value: unknown,
) {
  return vi.spyOn(service, method).mockResolvedValue(value as never);
}

function studentsFixture(churnScores: number[]): ControlCenterStudentsResponse {
  return {
    data: {
      students: churnScores.map((score, i) => ({
        id: `${i}`,
        name: `Aluno ${i}`,
        email: null,
        phoneNumber: '+5511999990000',
        status: 'ACTIVE',
        subscriptionStatus: null,
        protocolStatus: null,
        churnRisk: { score, signals: [] },
      })) as unknown as ControlCenterStudentsResponse['data']['students'],
      aiBlockedRate: metric(0, { unit: 'PERCENT' }),
      northStar: {
        averageCompletions: metric(0, { unit: 'COUNT' }),
        target: 8,
        reportingRate: metric(0, { unit: 'PERCENT' }),
        cohortSize: 0,
        bySource: [],
      },
      declaredAdherenceRate: metric(0, { unit: 'PERCENT' }),
    },
    meta: META,
  };
}

function financeFixture(
  revenueAtRisk30d: number,
  last90Days = [0],
  profitBrl: number | null = 120,
): ControlCenterFinanceResponse {
  return {
    data: {
      contractedMrr: metric(500, { unit: 'BRL' }),
      profit: metric(profitBrl, { unit: 'BRL' }),
      revenueAtRisk30d: metric(revenueAtRisk30d, { unit: 'BRL' }),
      churnByReason: last90Days.map((n, i) => ({ reason: `motivo_${i}`, total: n, last90Days: n })),
    } as unknown as ControlCenterFinanceResponse['data'],
    meta: META,
  };
}

function marketingFixture(
  formStarted: number,
  formSubmitted: number,
  channelCacBrl: number | null = 40,
): ControlCenterMarketingResponse {
  return {
    data: {
      funnel: {
        formStarted: metric(formStarted),
        formSubmitted: metric(formSubmitted),
      },
      channelEconomics: [
        { channel: 'organico', students: 12, cac: metric(null, { unit: 'BRL' }) },
        { channel: 'meta_ads', students: 30, cac: metric(channelCacBrl, { unit: 'BRL' }) },
      ],
    } as unknown as ControlCenterMarketingResponse['data'],
    meta: META,
  };
}

function systemFixture(
  slos: Array<{
    status: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';
    title: string;
    currentPercent: number | null;
    errorBudgetConsumedPercent: number | null;
    objective: string;
  }>,
): ControlCenterSystemResponse {
  return {
    data: { slos } as unknown as ControlCenterSystemResponse['data'],
    meta: META,
  };
}

const SLO_OK = {
  status: 'GREEN' as const,
  title: 'Resposta do AI Coach em até 30 segundos',
  currentPercent: 99,
  errorBudgetConsumedPercent: 10,
  objective: 'Ao menos 95% em até 30s.',
};

describe('ControlCenterService overview (US-7.8)', () => {
  it('inclui só os pilares cuja capability o papel tem — os demais não são sequer calculados', async () => {
    const { service } = serviceWithSystemResults();
    stubPillar(service, 'students', studentsFixture([0, 0]));
    const financeSpy = stubPillar(service, 'finance', financeFixture(0));
    const marketingSpy = stubPillar(service, 'marketing', marketingFixture(0, 0));
    const systemSpy = stubPillar(service, 'system', systemFixture([SLO_OK]));

    const response = await service.overview({ ...ACTOR, role: 'SUPPORT' });

    expect(response.data.pillars).toHaveLength(1);
    expect(response.data.pillars[0]?.pillar).toBe('STUDENTS');
    expect(financeSpy).not.toHaveBeenCalled();
    expect(marketingSpy).not.toHaveBeenCalled();
    expect(systemSpy).not.toHaveBeenCalled();
  });

  it('ADMIN vê os 5 pilares, cada linha reaproveitando o número do próprio pilar', async () => {
    const { service } = serviceWithSystemResults(
      [{ total: 2 }],
      [{ total: 40, blocked: 1, validated: 20 }],
    );
    stubPillar(service, 'students', studentsFixture([0, 1]));
    stubPillar(service, 'finance', financeFixture(0));
    stubPillar(service, 'marketing', marketingFixture(100, 80));
    stubPillar(service, 'system', systemFixture([SLO_OK]));

    const response = await service.overview({ ...ACTOR, role: 'ADMIN' });

    expect(response.data.pillars.map((p) => p.pillar)).toEqual([
      'STUDENTS',
      'FINANCE',
      'MARKETING',
      'AI',
      'SYSTEM',
    ]);
    const students = response.data.pillars.find((p) => p.pillar === 'STUDENTS');
    expect(students?.headline.metric.value).toBe(2);
    const finance = response.data.pillars.find((p) => p.pillar === 'FINANCE');
    expect(finance?.headline.metric.value).toBe(500);
    const marketing = response.data.pillars.find((p) => p.pillar === 'MARKETING');
    expect(marketing?.headline.metric.value).toBe(100);
  });

  it('fica CRITICAL quando há alerta de segurança, mesmo sem risco de cancelamento', async () => {
    const { service } = serviceWithSystemResults(
      [{ total: 3 }],
      [{ total: 0, blocked: 0, validated: 0 }],
    );
    stubPillar(service, 'students', studentsFixture([0, 0]));

    const response = await service.overview({ ...ACTOR, role: 'PROFESSIONAL' });

    const students = response.data.pillars.find((p) => p.pillar === 'STUDENTS');
    expect(students?.state).toBe('CRITICAL');
    expect(students?.reason).toMatch(/alerta/);
  });

  it('Financeiro fica ATTENTION quando a receita em risco passa do limiar', async () => {
    const { service } = serviceWithSystemResults();
    stubPillar(service, 'finance', financeFixture(400));

    const response = await service.overview({ ...ACTOR, role: 'FINANCE' });

    expect(response.data.pillars[0]).toMatchObject({ pillar: 'FINANCE', state: 'ATTENTION' });
  });

  it('Marketing fica ATTENTION quando a conclusão da anamnese cai abaixo do limiar', async () => {
    const { service } = serviceWithSystemResults();
    stubPillar(service, 'marketing', marketingFixture(100, 20));

    const response = await service.overview({ ...ACTOR, role: 'MARKETING' });

    expect(response.data.pillars[0]).toMatchObject({ pillar: 'MARKETING', state: 'ATTENTION' });
  });

  it('Financeiro fica ATTENTION com lucro negativo, mesmo sem receita em risco (US-8.8)', async () => {
    const { service } = serviceWithSystemResults();
    stubPillar(service, 'finance', financeFixture(0, [0], -10));

    const response = await service.overview({ ...ACTOR, role: 'FINANCE' });

    expect(response.data.pillars[0]).toMatchObject({ pillar: 'FINANCE', state: 'ATTENTION' });
    expect(response.data.pillars[0]?.details.map((d) => d.label)).toContain('Lucro do período');
    expect(response.data.pillars[0]?.reason).toMatch(/Lucro do período negativo/);
  });

  it('Marketing ancora no CAC do canal principal e alerta acima do teto (US-8.8)', async () => {
    const { service } = serviceWithSystemResults();
    stubPillar(service, 'marketing', marketingFixture(100, 90, 200));

    const response = await service.overview({ ...ACTOR, role: 'MARKETING' });

    const marketing = response.data.pillars[0];
    // O canal principal é o de mais cadastros (meta_ads), não o primeiro da lista.
    expect(marketing?.details.at(-1)).toMatchObject({
      label: 'CAC do canal principal (meta_ads)',
      metric: { value: 200 },
    });
    expect(marketing).toMatchObject({ state: 'ATTENTION' });
  });

  it('IA fica ATTENTION quando a taxa de resposta bloqueada passa do limiar', async () => {
    const { service } = serviceWithSystemResults([{ total: 100, blocked: 6, validated: 100 }]);
    stubPillar(service, 'system', systemFixture([SLO_OK]));

    const response = await service.overview({ ...ACTOR, role: 'ENGINEERING' });

    const ai = response.data.pillars.find((p) => p.pillar === 'AI');
    expect(ai?.state).toBe('ATTENTION');
  });

  it('Sistema herda o pior SLO: um RED vira CRITICAL na linha-resumo', async () => {
    const { service } = serviceWithSystemResults([{ total: 0, blocked: 0, validated: 0 }]);
    stubPillar(
      service,
      'system',
      systemFixture([
        SLO_OK,
        {
          status: 'RED',
          title: 'Trabalhos que não viraram tarefa manual',
          currentPercent: 90,
          errorBudgetConsumedPercent: 120,
          objective: 'Menos de 0,5% em DLQ.',
        },
      ]),
    );

    const response = await service.overview({ ...ACTOR, role: 'ENGINEERING' });

    const system = response.data.pillars.find((p) => p.pillar === 'SYSTEM');
    expect(system?.state).toBe('CRITICAL');
    expect(system?.headline.label).toBe('Trabalhos que não viraram tarefa manual');
  });
});

describe('ControlCenterService projections', () => {
  /**
   * Ordem dos `select` em `marketing()`: funil macro, funil da anamnese, ponto de
   * parada da etapa 1, sazonalidade de cadastro e as quatro dimensões agregadas.
   */
  function marketingHead(
    macro: unknown,
    funnel: unknown = { settledSessions: 100, reached2: 60, reached3: 40, submitted: 30 },
    exit: unknown = { identification: 25, codeSent: 15, afterVerification: 0 },
  ) {
    return [
      [macro],
      [funnel],
      [exit],
      [
        { dayOfWeek: 2, hour: 20, total: 12 },
        { dayOfWeek: 3, hour: 9, total: 9 },
      ],
    ];
  }

  it('calcula campanha por utm_campaign e suprime n menor que 10 sem tolerancia numerica', async () => {
    withExecute(
      [
        {
          month: '2026-01',
          cohort_size: 20,
          converted: 8,
          retained: 7,
          reconstructed: false,
        },
      ],
      [
        {
          source: 'instagram',
          medium: 'cpc',
          campaign: 'lancamento_agosto',
          students: 12,
          converted: 3,
          received_cents: '240000',
        },
        {
          source: 'instagram',
          medium: 'cpc',
          campaign: 'teste_pequeno',
          students: 9,
          converted: 2,
          received_cents: '90000',
        },
      ],
    );
    const { service } = serviceWithSystemResults(
      [
        { channel: 'meta_ads', campaign: 'lancamento_agosto', cents: '120000' },
        { channel: 'meta_ads', campaign: 'teste_pequeno', cents: '9000' },
      ],
      [{ months: 2 }],
    );

    const response = await service.campaigns();
    expect(response.data.suppressedCampaigns).toBe(1);
    expect(response.data.mediaInvestmentBrl).toBe(1290);
    expect(response.data.campaigns).toHaveLength(1);
    expect(response.data.campaigns[0]).toMatchObject({
      campaign: 'lancamento_agosto',
      channel: 'meta_ads',
      students: 12,
      converted: 3,
      investmentBrl: 1200,
      cac: { value: 400 },
      receivedRevenue: { value: 2400 },
      roas: { value: 2 },
      ltv: { value: 800 },
      ltvToCac: { value: 2 },
      paybackMonths: { value: 1 },
      signal: 'ATTENTION',
    });
    expect(controlCenterCampaignsResponseSchema.safeParse(response).success).toBe(true);
  });

  it('suprime segmentos de marketing com menos de 10 registros', async () => {
    const { service } = serviceWithSystemResults(
      ...marketingHead({
        formStarted: 20,
        formSubmitted: 18,
        protocolActive: 15,
        subscriptionActive: 12,
      }),
      [
        { value: 'GAIN_STRENGTH', total: 9 },
        { value: 'LOSE_FAT', total: 10 },
      ],
      [{ value: 'HOME', total: 8 }],
      [{ value: 'MORNING', total: 11 }],
      [{ value: '25-34', total: 14 }],
      [],
      [{ total: 0 }],
    );

    const response = await service.marketing();

    expect(response.data.segments).toEqual([
      { dimension: 'PREFERRED_PERIOD', value: 'MORNING', count: 11 },
      { dimension: 'AGE_BAND', value: '25-34', count: 14 },
    ]);
    expect(response.data.suppressedSegments).toBe(3);
    expect(response.data.acquisition).toMatchObject({ value: 0, status: 'AVAILABLE' });
    expect(JSON.stringify(response)).not.toMatch(/phone|email|parq|pain|health/i);
  });

  it('suprime também totais de funil entre 1 e 9', async () => {
    const { service } = serviceWithSystemResults(
      ...marketingHead({
        formStarted: 12,
        formSubmitted: 9,
        protocolActive: 1,
        subscriptionActive: 0,
      }),
      [],
      [],
      [],
      [],
      [],
      [{ total: 0 }],
    );

    const response = await service.marketing();

    expect(response.data.funnel.formStarted).toMatchObject({ value: 12, status: 'AVAILABLE' });
    expect(response.data.funnel.formSubmitted).toMatchObject({
      value: null,
      status: 'UNAVAILABLE',
    });
    expect(response.data.funnel.protocolActive).toMatchObject({
      value: null,
      status: 'UNAVAILABLE',
    });
    expect(response.data.funnel.subscriptionActive).toMatchObject({
      value: 0,
      status: 'AVAILABLE',
    });
  });

  it('não devolve valor de segmento fora do vocabulário fechado', async () => {
    const { service } = serviceWithSystemResults(
      ...marketingHead({
        formStarted: 20,
        formSubmitted: 20,
        protocolActive: 20,
        subscriptionActive: 20,
      }),
      [{ value: 'pessoa@example.com', total: 12 }],
      [],
      [],
      [],
      [],
      [{ total: 0 }],
    );

    const response = await service.marketing();

    expect(response.data.segments).toEqual([]);
    expect(response.data.suppressedSegments).toBe(1);
    expect(JSON.stringify(response)).not.toContain('pessoa@example.com');
  });

  it('publica o funil da anamnese, aponta a etapa de maior queda e o ponto de parada', async () => {
    const { service } = serviceWithSystemResults(
      ...marketingHead({
        formStarted: 100,
        formSubmitted: 30,
        protocolActive: 25,
        subscriptionActive: 20,
      }),
      [],
      [],
      [],
      [],
      [],
      [{ total: 0 }],
    );

    const response = await service.marketing();
    const { anamnesisFunnel, signupSeasonality } = response.data;

    expect(anamnesisFunnel.steps.map((step) => step.abandoned)).toEqual([40, 20, 10]);
    expect(anamnesisFunnel.worstStep).toBe(1);
    expect(anamnesisFunnel.exitPoint).toMatchObject({
      status: 'AVAILABLE',
      step: 1,
      checkpoint: 'Identificação (nome, nascimento, telefone)',
      count: 25,
    });
    expect(signupSeasonality).toHaveLength(7 * 24);
    expect(signupSeasonality.find((cell) => cell.dayOfWeek === 2 && cell.hour === 20)?.value).toBe(
      12,
    );
  });

  /**
   * TASK-7.9.2 — k-anonimato do pilar Marketing como gate bloqueante. A asserção é
   * sobre o payload inteiro contra o contrato (`kAnonymousCount`), não sobre uma
   * célula escolhida a dedo: plantar qualquer célula entre 1 e 9 em qualquer
   * dimensão (segmento, funil da anamnese ou heatmap) reprova aqui.
   */
  it('nenhuma célula entre 1 e 9 sai no payload do Marketing, nem no heatmap de sazonalidade', async () => {
    const { service } = serviceWithSystemResults(
      ...marketingHead({
        formStarted: 40,
        formSubmitted: 35,
        protocolActive: 30,
        subscriptionActive: 25,
      }),
      [{ value: 'LOSE_FAT', total: 3 }],
      [{ value: 'HOME', total: 1 }],
      [{ value: 'MORNING', total: 9 }],
      [{ value: '25-34', total: 2 }],
      [],
      [{ total: 0 }],
    );

    const response = await service.marketing();

    // Contrato: `kAnonymousCount` reprova qualquer inteiro entre 1 e 9 no payload.
    expect(controlCenterMarketingResponseSchema.safeParse(response).success).toBe(true);
    // A célula pequena do heatmap é suprimida; a grande continua publicada.
    const cell = (dayOfWeek: number, hour: number) =>
      response.data.signupSeasonality.find((c) => c.dayOfWeek === dayOfWeek && c.hour === hour)
        ?.value;
    expect(cell(3, 9)).toBe(0);
    expect(cell(2, 20)).toBe(12);
    // Supressão complementar: a dimensão inteira sai, senão a célula pequena volta por subtração.
    expect(response.data.segments).toEqual([]);
    expect(response.data.suppressedSegments).toBe(4);
  });

  it('não abre drill-down para indivíduo a partir do Marketing', async () => {
    const { service } = serviceWithSystemResults(
      ...marketingHead({
        formStarted: 40,
        formSubmitted: 35,
        protocolActive: 30,
        subscriptionActive: 25,
      }),
      [{ value: 'LOSE_FAT', total: 21 }],
      [],
      [],
      [],
      [],
      [{ total: 0 }],
    );

    const payload = JSON.stringify(await service.marketing());

    // Nenhum identificador direto nem indireto que permita chegar a uma pessoa.
    expect(payload).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(payload).not.toMatch(/userId|studentId|subscriptionId|phone|email|birthDate|@/i);
  });

  it('suprime o funil da anamnese inteiro quando uma célula cairia entre 1 e 9', async () => {
    const { service } = serviceWithSystemResults(
      ...marketingHead(
        { formStarted: 100, formSubmitted: 30, protocolActive: 25, subscriptionActive: 20 },
        { settledSessions: 100, reached2: 95, reached3: 90, submitted: 85 },
      ),
      [],
      [],
      [],
      [],
      [],
      [{ total: 0 }],
    );

    const response = await service.marketing();

    expect(response.data.anamnesisFunnel.steps).toEqual([]);
    expect(response.data.anamnesisFunnel.worstStep).toBeNull();
    expect(response.data.anamnesisFunnel.exitPoint.status).toBe('UNAVAILABLE');
  });

  /**
   * US-8.6 — CAC, ROAS e LTV/CAC por canal. Confere contra o cálculo manual (tolerância 0)
   * e prova a regra que a DoD mede: canal sem investimento **nunca** exibe R$ 0,00.
   *
   * `execute` em ordem: conversão de trial, coortes de entrada, origem por titular.
   */
  it('calcula CAC/ROAS/LTV-CAC por canal e nunca publica CAC zero em canal sem investimento', async () => {
    withExecute(
      [{ trials: 60, converted: 15, median_days: '5', reconstructed: 0 }],
      [],
      [
        {
          source: 'instagram',
          medium: 'cpc',
          students: 40,
          converted: 10,
          received_cents: '400000',
        },
        { source: 'organico', medium: null, students: 20, converted: 5, received_cents: '100000' },
      ],
    );
    const { service } = serviceWithSystemResults(
      ...marketingHead({
        formStarted: 60,
        formSubmitted: 50,
        protocolActive: 40,
        subscriptionActive: 30,
      }),
      [],
      [],
      [],
      [],
      // Aquisição por canal (US-8.2) e origem não capturada.
      [
        { source: 'instagram', medium: 'cpc', total: 40 },
        { source: 'organico', medium: null, total: 20 },
      ],
      [{ total: 0 }],
      // `ad_spend` agregado por canal: só mídia paga tem investimento.
      [{ channel: 'meta_ads', cents: '200000' }],
      // Meses distintos com liquidação — divisor do ARPU mensal do payback.
      [{ months: 2 }],
    );

    const response = await service.marketing();
    const economics = response.data.channelEconomics;
    const paid = economics.find((channel) => channel.channel === 'meta_ads');
    const organic = economics.find((channel) => channel.channel === 'organico');

    expect(response.data.attributionWindowDays).toBe(60);
    expect(response.data.mediaInvestmentBrl).toBe(2000);

    // R$2.000 ÷ 10 convertidos = R$200 de CAC; R$4.000 recebidos ÷ R$2.000 = ROAS 2.
    expect(paid?.investmentBrl).toBe(2000);
    expect(paid?.cac.value).toBe(200);
    expect(paid?.roas.value).toBe(2);
    expect(paid?.receivedRevenue.value).toBe(4000);
    // LTV = R$4.000 ÷ 10; sem coorte madura a estimativa NÃO pode sair como disponível.
    expect(paid?.ltv.value).toBe(400);
    expect(paid?.ltv.status).toBe('PROXY');
    expect(paid?.ltvToCac.value).toBe(2);
    // Payback = CAC ÷ (LTV ÷ 2 meses observados) = 200 ÷ 200 = 1 mês.
    expect(paid?.paybackMonths.value).toBe(1);
    expect(paid?.signal).toBe('ATTENTION');

    // Canal orgânico: rótulo, nunca zero — dividir por zero produz um número bonito e falso.
    expect(organic?.investmentBrl).toBeNull();
    expect(organic?.investmentStatus).toBe('NO_DIRECT_INVESTMENT');
    expect(organic?.cac).toMatchObject({ value: null, status: 'UNAVAILABLE' });
    expect(organic?.roas).toMatchObject({ value: null, status: 'UNAVAILABLE' });
    expect(organic?.signal).toBe('UNKNOWN');

    expect(controlCenterMarketingResponseSchema.safeParse(response).success).toBe(true);
  });

  /**
   * Ordem dos `select` em `finance()`: billing, planos, calendário, risco, churn, despesas,
   * e — desde a US-8.5 — liquidação por mês, prazo médio e fila de exceção.
   */
  function financeResults(
    payments: unknown[] = [],
    settlementLag: unknown[] = [],
    exceptions: unknown[] = [],
  ): unknown[][] {
    return [
      [{ active: 7, contractedMrr: '273.00' }],
      [
        { plan: 'MONTHLY', active: 4, contractedBrl: '156.00' },
        { plan: 'QUARTERLY', active: 3, contractedBrl: '297.00' },
      ],
      [{ month: '2026-09', plan: 'QUARTERLY', subscriptions: 3, amountBrl: '297.00' }],
      [
        {
          subscriptionId: '55555555-5555-4555-8555-555555555555',
          plan: 'QUARTERLY',
          currentPeriodEnd: new Date('2026-09-02T12:00:00.000Z'),
          amountBrl: '99.00',
        },
      ],
      [{ reason: 'PRECO', total: 5, last90Days: 3 }],
      // US-8.4: despesas por mês/categoria (centavos inteiros; estorno já somado).
      [],
      // US-8.5: liquidação recebida por mês, prazo médio e fila de exceção.
      payments,
      settlementLag,
      exceptions,
    ];
  }

  /**
   * Linhas de `tx.execute` do custo de IA. Vêm já precificadas pelo SQL (LATERAL contra
   * `model_pricing` com a vigência da data do job) — o custo em USD é o que a query
   * devolve; a suíte confere a conversão para BRL e o tratamento de modelo sem preço.
   */
  function aiCostRows() {
    return [
      {
        model: 'gpt-4.1-2025-04-14',
        jobs: 10,
        tokens_input: 1_000_000,
        tokens_output: 100_000,
        priced_jobs: 10,
        cost_usd: 2.8,
      },
      {
        model: 'modelo-sem-preco',
        jobs: 2,
        tokens_input: 500,
        tokens_output: 100,
        priced_jobs: 0,
        cost_usd: 0,
      },
    ];
  }

  it('financeiro retorna apenas agregados reais e marca fontes ausentes', async () => {
    withExecute(aiCostRows());
    const { service } = serviceWithSystemResults(...financeResults());

    const response = await service.finance();

    expect(response.data.activeSubscriptions.value).toBe(7);
    expect(response.data.contractedMrr.value).toBe(273);
    expect(response.data.receivedRevenue.status).toBe('UNAVAILABLE');
    expect(response.data.profit.status).toBe('UNAVAILABLE');
    expect(response.data.customerAcquisitionCost.status).toBe('UNAVAILABLE');
    expect(JSON.stringify(response.data)).not.toMatch(/phoneNumber|email|userId/);
  });

  it('calendário, risco, churn por motivo e MRR/ARR por plano conferem com o cálculo manual', async () => {
    withExecute(aiCostRows());
    const { service } = serviceWithSystemResults(...financeResults());

    const response = await service.finance();

    expect(response.data.renewalCalendar).toEqual([
      { month: '2026-09', plan: 'QUARTERLY', subscriptions: 3, amountBrl: 297 },
    ]);
    // R$99 do único trimestral vencendo em 30 dias sem conversa recente.
    expect(response.data.revenueAtRisk30d.value).toBe(99);
    expect(response.data.subscriptionsAtRisk[0]?.riskSignal).toBe(
      'Sem mensagem recebida há 14 dias',
    );
    expect(response.data.churnByReason).toEqual([{ reason: 'PRECO', total: 5, last90Days: 3 }]);
    // Trimestral: R$297 contratados ÷ 3 meses = R$99 de MRR, R$1.188 de ARR.
    expect(response.data.mrrByPlan).toEqual([
      { plan: 'MONTHLY', activeSubscriptions: 4, mrrBrl: 156, arrBrl: 1872 },
      { plan: 'QUARTERLY', activeSubscriptions: 3, mrrBrl: 99, arrBrl: 1188 },
    ]);
  });

  it('converte tokens em reais pela tabela de preço e não inventa custo de modelo desconhecido', async () => {
    withExecute(aiCostRows());
    const { service } = serviceWithSystemResults(...financeResults());

    const response = await service.finance();

    // TASK-7.9.4 — conferência com tolerância 0 (`toBe`, não `toBeCloseTo`).
    // Cálculo manual, fora do código de produção:
    //   entrada: 1.000.000 tokens ÷ 1000 = 1000 × US$0,002 = US$2,00
    //   saída:     100.000 tokens ÷ 1000 =  100 × US$0,008 = US$0,80
    //   US$2,80 × câmbio 5,4 = R$15,12 (exato em double: 15.12)
    const EXPECTED_AI_COST_BRL = 15.12;
    expect(response.data.aiCostByModel[0]?.costBrl).toBe(EXPECTED_AI_COST_BRL);
    expect(response.data.aiCostByModel[1]?.costBrl).toBeNull();
    expect(response.data.aiCost.value).toBe(EXPECTED_AI_COST_BRL);
    // 7 assinaturas ativas na fixture: R$15,12 ÷ 7 = R$2,16 (2.1599999999999997 em double —
    // por isso a divisão é reproduzida aqui em vez de um literal arredondado).
    expect(response.data.aiCostPerActiveUser.value).toBe(EXPECTED_AI_COST_BRL / 7);
  });

  it('marca o custo de IA como indisponível quando nenhum modelo tem preço cadastrado', async () => {
    withExecute([aiCostRows()[1]]);
    const { service } = serviceWithSystemResults(...financeResults());

    const response = await service.finance();

    expect(response.data.aiCost.status).toBe('UNAVAILABLE');
    expect(response.data.aiCost.value).toBeNull();
    expect(response.data.aiCostPerActiveUser.status).toBe('UNAVAILABLE');
  });

  it('custo por categoria/mês e lucro conferem com o cálculo manual e declaram o regime', async () => {
    const results = financeResults();
    // Mês corrente na fixture; `expensePerActiveUser`/`profit` usam só este mês.
    const month = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
    }).format(new Date());
    results[5] = [
      { month, category: 'INFRA', amountCents: '12000' },
      { month, category: 'IA_LLM', amountCents: '3000' },
      // Estorno de R$20 sobre a linha de marketing de R$50 → líquido R$30.
      { month, category: 'MARKETING', amountCents: '3000' },
      { month: '2026-01', category: 'INFRA', amountCents: '9900' },
    ];
    withExecute(aiCostRows());
    const { service } = serviceWithSystemResults(...results);

    const response = await service.finance();

    // Cálculo manual, fora do código de produção: R$120 + R$30 + R$30 = R$180 no mês.
    expect(response.data.totalExpense.value).toBe(180);
    expect(response.data.costByCategory).toEqual([
      { category: 'INFRA', amountBrl: 219 },
      { category: 'IA_LLM', amountBrl: 30 },
      { category: 'MARKETING', amountBrl: 30 },
    ]);
    expect(response.data.costByMonth.at(-1)).toEqual({ month, amountBrl: 180 });
    expect(response.data.infrastructureCost.value).toBe(219);
    // R$180 ÷ 7 assinaturas ativas.
    expect(response.data.expensePerActiveUser.value).toBe(180 / 7);
    // Lucro = MRR contratado R$273 − despesa R$180 = R$93, tolerância 0.
    expect(response.data.profit.value).toBe(93);
    // Regime declarado: proxy contratado enquanto NÃO houver liquidação em `payments`.
    expect(response.data.profit.status).toBe('PROXY');
    expect(response.data.profitBasis).toBe('CONTRATADO_PROXY');
  });

  /**
   * TASK-8.9.4 — dupla contagem de gasto de mídia = 0. `ad_spend` é a fonte de verdade do
   * investimento por canal e a categoria `MARKETING` de `expenses` cobre marketing que não
   * é mídia direta; as duas nunca descrevem o mesmo real. A regra é uma frase de docstring
   * até virar teste: se alguém somar `ad_spend` ao custo do Financeiro, cada real de mídia
   * passa a entrar duas vezes no lucro — número plausível e errado, a pior classe de bug
   * desta sprint.
   */
  it('finance() não lê `ad_spend`: gasto de mídia entra uma única vez, pelo Marketing (US-8.6)', async () => {
    withExecute(aiCostRows());
    const { service } = serviceWithSystemResults(...financeResults());

    await service.finance();

    expect(touchedTables).toContain('expenses');
    expect(touchedTables).not.toContain('ad_spend');
  });

  it('com liquidação registrada o lucro passa a regime de CAIXA e a taxa do gateway vira custo (US-8.5)', async () => {
    const month = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
    }).format(new Date());
    const results = financeResults(
      // R$200 brutos liquidados, R$190 creditados → R$10 de taxa do gateway.
      [{ month, grossCents: '20000', netCents: '19000', settlements: 4, failures: 1 }],
      [{ days: '2.5' }],
      [],
    );
    results[5] = [{ month, category: 'INFRA', amountCents: '12000' }];
    withExecute(aiCostRows());
    const { service } = serviceWithSystemResults(...results);

    const response = await service.finance();

    // As duas séries convivem, nomeadas e separadas — e nunca são somadas.
    expect(response.data.contractedMrr.value).toBe(273);
    expect(response.data.receivedRevenue.value).toBe(200);
    expect(response.data.receivedRevenueByMonth).toEqual([
      { month, grossBrl: 200, netBrl: 190, settlements: 4 },
    ]);

    // Taxa do gateway = bruto − líquido, exibida e também somada em Custos.
    expect(response.data.gatewayFee.value).toBe(10);
    expect(response.data.gatewayFeePercent.value).toBe(5);
    expect(response.data.costByCategory).toContainEqual({
      category: 'GATEWAY_PAGAMENTO',
      amountBrl: 10,
    });

    // Cálculo manual: recebido R$200 − (despesa R$120 + taxa R$10) = R$70, tolerância 0.
    expect(response.data.profit.value).toBe(70);
    expect(response.data.profit.status).toBe('AVAILABLE');
    expect(response.data.profitBasis).toBe('CAIXA');

    // 1 falha em 5 tentativas = 20% de inadimplência no período.
    expect(response.data.delinquencyRate.value).toBe(20);
    expect(response.data.averageSettlementDays.value).toBe(2.5);
  });

  it('liquidação órfã aparece na fila de exceção — nunca é descartada (US-8.5)', async () => {
    const occurredAt = new Date('2026-08-01T12:00:00.000Z');
    const results = financeResults(
      [],
      [],
      [
        {
          paymentId: '66666666-6666-4666-8666-666666666666',
          gateway: 'STRIPE',
          status: 'SETTLED',
          amountCents: 3900,
          occurredAt,
          receivedAt: occurredAt,
        },
      ],
    );
    withExecute(aiCostRows());
    const { service } = serviceWithSystemResults(...results);

    const response = await service.finance();

    expect(response.data.paymentExceptions).toEqual([
      {
        paymentId: '66666666-6666-4666-8666-666666666666',
        gateway: 'STRIPE',
        status: 'SETTLED',
        amountBrl: 39,
        occurredAt: occurredAt.toISOString(),
        receivedAt: occurredAt.toISOString(),
      },
    ]);
    // Sem titular por construção: se houvesse, não seria exceção.
    expect(JSON.stringify(response.data.paymentExceptions)).not.toMatch(/userId|email|phone/);
  });

  it('lista de alunos (recorte de suporte) não carrega nenhum campo de saúde', async () => {
    const student = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Pessoa',
      email: 'pessoa@example.com',
      phoneNumber: '+5511999999999',
      status: 'ACTIVE',
      subscriptionStatus: 'ACTIVE',
      protocolStatus: 'ACTIVE',
    };
    const { service, db } = serviceWithSystemResults([student], [{ blocked: 0, validated: 0 }]);

    const response = await service.students({ ...ACTOR, role: 'SUPPORT' });

    // US-7.4 acrescenta só o risco comercial de cancelamento à projeção.
    expect(response.data.students).toEqual([{ ...student, churnRisk: { score: 0, signals: [] } }]);
    // US-7.1: o filtro é no servidor. Quem tem só `students.read` recebe um payload sem
    // anamnese, PAR-Q, dor ou check-in — não é a UI que esconde.
    // Asserção sobre a projeção do aluno, não sobre o envelope: desde a US-8.1 as
    // definições das métricas agregadas mencionam "check-in" em texto legível.
    expect(JSON.stringify(response.data.students)).not.toMatch(
      /parq|anamnes|checkin|conversation|pain/i,
    );
    // A2: a LISTAGEM passa pela RLS no contexto do ator. `runAsSystem` só aparece nos
    // agregados da base (North Star e adesão declarada), que não são projeção de aluno.
    expect(db.runAsUser).toHaveBeenCalled();
    expect(db.runAsUser).toHaveBeenCalledWith(ACTOR.userId, 'SUPPORT', expect.any(Function));
  });

  it('audita a listagem de alunos com o volume de PII devolvido', async () => {
    const { service, audit } = serviceWithSystemResults(
      [{ id: 'a' }, { id: 'b' }],
      [{ blocked: 0, validated: 0 }],
    );

    await service.students({ ...ACTOR, role: 'PROFESSIONAL' });

    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: ACTOR.userId,
        action: 'STUDENTS_LIST_VIEWED',
        changes: expect.objectContaining({ recordCount: 2 }),
      }),
    );
  });

  it('não inventa latência zero quando nenhum job possui amostra', async () => {
    const { service } = serviceWithSystemResults(
      [{ total: 0, completed: 0, failed: 0, dlq: 0, samples: 0, p50: null, p95: null, p99: null }],
      [],
      [],
      [{ samples: 0, p50: null, p95: null, p99: null, withinSla: 0 }],
      [],
      [{ total: 12 }],
    );

    const response = await service.system();

    expect(response.data.aiLatency.p95).toMatchObject({ value: null, status: 'UNAVAILABLE' });
    expect(response.data.whatsappLatency.p95).toMatchObject({ value: null, status: 'UNAVAILABLE' });
    // Sem amostra o semáforo é UNKNOWN — nunca verde por ausência de erro.
    expect(response.data.slos.every((slo) => slo.status === 'UNKNOWN')).toBe(true);
  });

  it('publica percentis reais e o orçamento de erro consumido por SLO', async () => {
    const { service } = serviceWithSystemResults(
      [
        {
          total: 100,
          completed: 98,
          failed: 2,
          dlq: 0,
          samples: 100,
          p50: '1200',
          p95: '4800.5',
          p99: '9000',
          protocolsDelivered: 100,
          protocolsWithinSla: 97,
        },
      ],
      [
        {
          model: 'gpt-4.1',
          jobType: 'AI_RESPONSE',
          samples: 100,
          p50: '1200',
          p95: '4800',
          p99: '9000',
        },
      ],
      [{ day: '2026-08-12', total: '4800.5' }],
      [{ samples: 50, p50: '9000', p95: '25000', p99: '31000', withinSla: 49 }],
      [],
      [{ total: 12 }],
    );

    const response = await service.system();

    expect(response.data.aiLatency.p95).toMatchObject({ value: 4800.5, status: 'AVAILABLE' });
    expect(response.data.aiLatencyByModel[0]).toMatchObject({ model: 'gpt-4.1', p95: 4800 });
    // Série diária é de inteiros: o percentil fracionário é arredondado.
    expect(response.data.aiLatencyP95Daily.some((point) => point.value === 4801)).toBe(true);

    const delivery = response.data.slos.find((slo) => slo.key === 'PROTOCOL_DELIVERY');
    // 97% contra meta de 95%: sobra 5% de orçamento, 3% gasto = 60% consumido.
    expect(delivery).toMatchObject({
      currentPercent: 97,
      errorBudgetConsumedPercent: 60,
      status: 'GREEN',
    });
    const success = response.data.slos.find((slo) => slo.key === 'AI_JOB_SUCCESS');
    // 98% contra meta de 99%: orçamento de 1% com 2% gasto = 200% (estourado).
    expect(success).toMatchObject({ errorBudgetConsumedPercent: 200, status: 'RED' });
    expect(response.data.slos.length).toBeGreaterThanOrEqual(3);
    expect(response.data.slos.length).toBeLessThanOrEqual(5);
  });

  it('não exibe indicador ausente como zero: nomeia dependência e sprint', async () => {
    const { service } = serviceWithSystemResults(
      [{ total: 0, completed: 0, failed: 0, dlq: 0, samples: 0 }],
      [],
      [],
      [{ samples: 0, withinSla: 0 }],
      [],
      [{ total: 0 }],
    );

    const response = await service.system();

    // US-8.8: custo de infra/WhatsApp saiu da lista (virou número na US-8.4) e o
    // histórico de incidentes foi reapontado para a Sprint 9.
    expect(response.data.pendingCapabilities).toHaveLength(2);
    expect(response.data.pendingCapabilities.map((item) => item.plannedFor)).toEqual([
      'Sprint 9',
      'Fase 6 — Infraestrutura',
    ]);
    expect(JSON.stringify(response.data.pendingCapabilities)).not.toMatch(/Sprint 8/);
    // TASK-7.5.1: nenhum indicador desta tela é atribuído a OpenTelemetry.
    expect(response.meta.dataQuality.join(' ')).not.toMatch(/latência de IA é um proxy/i);
  });

  it('uso do RAG fica indisponível quando o Redis não responde, nunca zero', async () => {
    const { service } = serviceWithSystemResults(
      [{ total: 0, completed: 0, failed: 0, dlq: 0, samples: 0 }],
      [],
      [],
      [{ samples: 0, withinSla: 0 }],
      [],
      [{ total: 7 }],
    );
    Reflect.set(service, 'redis', { mget: vi.fn().mockRejectedValue(new Error('down')) });

    const response = await service.system();

    expect(response.data.ragQueries).toMatchObject({ value: null, status: 'UNAVAILABLE' });
    expect(response.data.ragCorpusChunks).toMatchObject({ value: 7, status: 'AVAILABLE' });
  });
});

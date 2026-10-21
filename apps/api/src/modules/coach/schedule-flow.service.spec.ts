import type { ProtocolStructure, Weekday } from '@movivo/shared';
import { describe, expect, it, vi } from 'vitest';

import { buildWeekSlots, type SessionRowSummary } from '../workout/schedule-planner';
import type {
  PreparedLink,
  WorkoutLinkDispatcherService,
} from '../workout/workout-link-dispatcher.service';
import type { LateLogResult, WorkoutLateLogService } from '../workout/workout-late-log.service';
import type { ScheduleContext, WorkoutScheduleService } from '../workout/workout-schedule.service';
import {
  answerToOffer,
  quickConflictAnswer,
  ScheduleFlowService,
  type ScheduleFlowInput,
} from './schedule-flow.service';
import type {
  ParsedScheduleRequest,
  ScheduleRequestParserService,
} from './schedule-request-parser.service';

const USER_ID = 'u1';
const MON = '2026-10-19';
const TUE = '2026-10-20';
const WED = '2026-10-21';
const THU = '2026-10-22';
const FRI = '2026-10-23';
const SAT = '2026-10-24';
const SUN = '2026-10-25';
const SEP = '\n---\n';
// Quarta a domingo todos ocupados (T3 T4 já são o padrão): nenhum descanso para absorver o empurrão.
const FULL_WEEK_OVERRIDES = new Map<string, string | null>([
  [FRI, 'T1'],
  [SAT, 'T2'],
  [SUN, 'T5'],
]);

function structure(sessions: Array<[string, Weekday, string]>): ProtocolStructure {
  return {
    weeklyFrequency: sessions.length,
    sessions: sessions.map(([dayLabel, weekday, focus]) => ({ dayLabel, weekday, focus })),
  } as unknown as ProtocolStructure;
}

const GABRIEL = structure([
  ['Treino A', 'THU', 'Costas e Bíceps'],
  ['Treino B', 'FRI', 'Pernas'],
  ['Treino C', 'SUN', 'Peito e Tríceps'],
]);
const JOAO = structure([
  ['T1', 'MON', 'Peito'],
  ['T2', 'TUE', 'Costas'],
  ['T3', 'WED', 'Pernas'],
  ['T4', 'THU', 'Ombros'],
  ['T5', 'SAT', 'Braços'],
]);

function context(
  protocol: ProtocolStructure,
  today: string,
  sessions: Record<string, SessionRowSummary> = {},
  overrides?: Map<string, string | null>,
): ScheduleContext {
  return {
    userId: USER_ID,
    name: 'Ana Souza',
    timezone: 'America/Sao_Paulo',
    today,
    localTime: '15:30',
    protocolId: 'p1',
    structure: protocol,
    quota: protocol.weeklyFrequency,
    firstProtocolDate: '2026-10-05',
    slots: buildWeekSlots({
      today,
      firstProtocolDate: '2026-10-05',
      structure: protocol,
      overrides,
      sessionsByDate: new Map(Object.entries(sessions)),
    }),
  };
}

function parsed(overrides: Partial<ParsedScheduleRequest>): ParsedScheduleRequest {
  return {
    action: 'OUTRO',
    date: null,
    invalidDate: null,
    sessionKey: null,
    leaveOut: [],
    placements: [],
    conflict: null,
    ...overrides,
  };
}

function make(options: {
  ctx?: ScheduleContext | null;
  parsed?: ParsedScheduleRequest;
  link?: PreparedLink;
  undo?: Awaited<ReturnType<WorkoutScheduleService['undoLast']>>;
  state?: unknown;
  offer?: boolean;
  lateLog?: LateLogResult;
  lateLinkText?: string | null;
}) {
  const store = new Map<string, string>();
  if (options.state) store.set('schedule-flow:state', JSON.stringify(options.state));
  if (options.offer) store.set('workout-refresh:offer', JSON.stringify({ date: TUE }));
  const redis = {
    exists: vi.fn(async (key: string) => (store.has(key) ? 1 : 0)),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  };
  const apply = vi.fn(async (_userId: string, _ctx: unknown, _plan: unknown, _meta: unknown) => ({
    adjustmentId: 'adj-1',
    created: true,
  }));
  const undoLast = vi.fn(async () => options.undo ?? { status: 'NOTHING_TO_UNDO' as const });
  const weekContext = vi.fn(async () => (options.ctx === undefined ? null : options.ctx));
  const schedule = { weekContext, apply, undoLast } as unknown as WorkoutScheduleService;
  const prepare = vi.fn(
    async (): Promise<PreparedLink> =>
      options.link ?? {
        status: 'READY',
        text: 'Boa tarde, *Ana*! link do treino',
        workoutId: 'w1',
        focus: 'Costas e Bíceps',
        sessionKey: 'Treino A',
        workoutStatus: 'PLANNED',
      },
  );
  const prepareLateLog = vi.fn(async (..._args: unknown[]) =>
    options.lateLinkText === null
      ? null
      : { text: options.lateLinkText ?? 'Boa tarde, *Ana*! link do registro' },
  );
  const links = { prepare, prepareLateLog } as unknown as WorkoutLinkDispatcherService;
  const begin = vi.fn(
    async (..._args: unknown[]): Promise<LateLogResult> =>
      options.lateLog ?? { status: 'OUT_OF_WINDOW' },
  );
  const lateLogs = { begin } as unknown as WorkoutLateLogService;
  const parse = vi.fn(async (..._args: unknown[]) => options.parsed ?? parsed({}));
  const parser = { parse } as unknown as ScheduleRequestParserService;
  const service = new ScheduleFlowService(
    schedule,
    links,
    lateLogs,
    parser,
    redis as never,
    { forUser: (_id: string, ...parts: string[]) => parts.join(':') } as never,
    { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() } as never,
  );
  const input = (intent: ScheduleFlowInput['intent'] = 'AJUSTE_AGENDA'): ScheduleFlowInput => ({
    userId: USER_ID,
    message: 'mensagem do aluno',
    intent,
    scrubUser: {} as never,
    operationId: 'op-123',
    personaSlot: null,
    now: new Date('2026-10-20T18:30:00.000Z'),
  });
  return { service, input, apply, undoLast, prepare, prepareLateLog, begin, parse, redis, store };
}

function text(outcome: Awaited<ReturnType<ScheduleFlowService['handle']>>): string {
  if (outcome.kind !== 'FIXED') throw new Error('esperava FIXED');
  return outcome.text;
}

describe('Gabriel: treina num dia sem treino', () => {
  it('antecipa o Treino A para hoje, libera a quinta e envia o link do dia logo depois', async () => {
    const { service, input, apply, prepare } = make({
      ctx: context(GABRIEL, TUE),
      parsed: parsed({ action: 'TREINAR', sessionKey: 'Treino A' }),
    });

    const outcome = await service.handle(input());

    expect(apply).toHaveBeenCalledTimes(1);
    const [, , plan, meta] = apply.mock.calls[0] as unknown as [
      string,
      unknown,
      { changes: Array<{ date: string; from: string | null; to: string | null }> },
      { kind: string; idempotencyKey: string },
    ];
    expect(plan.changes).toEqual([
      { date: TUE, from: null, to: 'Treino A' },
      { date: THU, from: 'Treino A', to: null },
    ]);
    expect(meta).toEqual({ kind: 'TRAIN_ON', idempotencyKey: 'chat:op-123' });
    expect(prepare).toHaveBeenCalledWith(USER_ID, 'ON_DEMAND', expect.any(Date));

    const bubbles = text(outcome).split(SEP);
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]).toContain('Treino A (Costas e Bíceps)');
    expect(bubbles[0]).toContain('*Quinta*: descanso');
    expect(bubbles[0]).toContain('desfazer');
    expect(bubbles[1]).toBe('Boa tarde, *Ana*! link do treino');
    expect(outcome).toMatchObject({ adjusted: true });
  });

  it('sem dizer a sessão, traz a próxima pendente', async () => {
    const { service, input, apply } = make({
      ctx: context(GABRIEL, TUE),
      parsed: parsed({ action: 'TREINAR' }),
    });
    await service.handle(input());
    const plan = apply.mock.calls[0]?.[2] as unknown as { changes: Array<{ to: string | null }> };
    expect(plan.changes[0]?.to).toBe('Treino A');
  });

  it('pedir um dia futuro não envia link agora (a varredura das 04:00 cuida)', async () => {
    const { service, input, prepare } = make({
      ctx: context(GABRIEL, TUE),
      parsed: parsed({ action: 'TREINAR', date: WED, sessionKey: 'Treino A' }),
    });
    const outcome = await service.handle(input());
    expect(prepare).not.toHaveBeenCalled();
    expect(text(outcome)).not.toContain(SEP);
  });

  it('hoje já é dia daquele treino: não altera nada e manda o link', async () => {
    const { service, input, apply, prepare } = make({
      ctx: context(GABRIEL, THU),
      parsed: parsed({ action: 'TREINAR' }),
    });
    const outcome = await service.handle(input());
    expect(apply).not.toHaveBeenCalled();
    expect(prepare).toHaveBeenCalledWith(USER_ID, 'RESEND', expect.any(Date));
    expect(text(outcome)).toContain('Hoje já é dia de');
    expect(text(outcome)).toContain('link do treino');
  });
});

describe('João: descansar em um dia', () => {
  const done = {
    [MON]: { status: 'COMPLETED', sessionKey: 'T1' },
    [TUE]: { status: 'COMPLETED', sessionKey: 'T2' },
  } as const;

  it('quarta vira descanso, os treinos andam e o descanso de sexta é consumido; sem link', async () => {
    const { service, input, apply, prepare } = make({
      ctx: context(JOAO, TUE, { ...done }),
      parsed: parsed({ action: 'DESCANSAR', date: WED }),
    });
    const outcome = await service.handle(input());
    const plan = apply.mock.calls[0]?.[2] as unknown as {
      changes: Array<{ date: string; to: string | null }>;
    };
    expect(plan.changes).toEqual([
      { date: WED, from: 'T3', to: null },
      { date: THU, from: 'T4', to: 'T3' },
      { date: FRI, from: null, to: 'T4' },
    ]);
    expect(prepare).not.toHaveBeenCalled();
    const reply = text(outcome);
    expect(reply).toContain('Descansar também faz parte do plano');
    expect(reply).toContain('*Quarta*: descanso');
    expect(reply).toContain('*Sábado*: T5 (Braços)');
  });

  it('descansar hoje depois do link das 04:00: confirma o descanso e não manda link novo', async () => {
    const { service, input, prepare } = make({
      ctx: context(JOAO, WED, { ...done }),
      parsed: parsed({ action: 'DESCANSAR', date: WED }),
    });
    const outcome = await service.handle({ ...input(), now: new Date('2026-10-21T18:30:00.000Z') });
    expect(prepare).not.toHaveBeenCalled();
    expect(text(outcome)).toContain('hoje é dia de descansar');
  });

  it('semana cheia: pergunta qual treino fica de fora e guarda o pedido', async () => {
    const full = context(JOAO, TUE, { ...done }, FULL_WEEK_OVERRIDES);
    const { service, input, apply, store } = make({
      ctx: full,
      parsed: parsed({ action: 'DESCANSAR', date: WED }),
    });
    const outcome = await service.handle(input());
    expect(apply).not.toHaveBeenCalled();
    expect(text(outcome)).toContain('um dos treinos precisa ficar de fora');
    expect(text(outcome)).toContain('1. *Quarta*');
    expect(JSON.parse(store.get('schedule-flow:state') as string)).toMatchObject({
      followUps: 1,
      leaveOut: { request: { kind: 'REST_ON', date: WED } },
    });
  });

  it('a resposta com o treino de fora conclui o pedido original e limpa o estado', async () => {
    const full = context(JOAO, TUE, { ...done }, FULL_WEEK_OVERRIDES);
    const state = {
      followUps: 1,
      leaveOut: {
        request: { kind: 'REST_ON', date: WED },
        candidates: [{ date: SAT, sessionKey: 'T2' }],
      },
    };
    const { service, input, apply, store } = make({
      ctx: full,
      state,
      parsed: parsed({ action: 'ESCOLHA', leaveOut: [{ date: SAT }] }),
    });
    const outcome = await service.handle({ ...input('PAPO_CASUAL') });
    const plan = apply.mock.calls[0]?.[2] as unknown as { dropped: string[] };
    expect(plan.dropped).toEqual(['T2']);
    expect(text(outcome)).toContain('fica de fora desta semana');
    expect(store.has('schedule-flow:state')).toBe(false);
  });

  it('fluxo aberto e mensagem de outro assunto: solta o estado e segue o roteamento normal', async () => {
    const state = {
      followUps: 1,
      leaveOut: {
        request: { kind: 'REST_ON', date: WED },
        candidates: [{ date: SAT, sessionKey: 'T2' }],
      },
    };
    const { service, input, store } = make({
      ctx: context(JOAO, TUE),
      state,
      parsed: parsed({ action: 'OUTRO' }),
    });
    expect(await service.handle(input('PAPO_CASUAL'))).toEqual({ kind: 'NOT_HANDLED' });
    expect(store.has('schedule-flow:state')).toBe(false);
  });

  it('depois de várias respostas sem entender, encerra a pergunta', async () => {
    const full = context(JOAO, TUE, { ...done }, FULL_WEEK_OVERRIDES);
    const state = {
      followUps: 3,
      leaveOut: {
        request: { kind: 'REST_ON', date: WED },
        candidates: [{ date: SAT, sessionKey: 'T2' }],
      },
    };
    const { service, input, store } = make({
      ctx: full,
      state,
      parsed: parsed({ action: 'DESCANSAR', date: WED }),
    });
    const outcome = await service.handle(input());
    expect(text(outcome)).toContain('Me conta com qual dia');
    expect(store.has('schedule-flow:state')).toBe(false);
  });
});

describe('o dia pedido já tem outro treino (pular ou empurrar)', () => {
  const conflictState = {
    followUps: 1,
    conflict: { request: { kind: 'TRAIN_ON', date: WED, sessionKey: 'T2' }, displacedKey: 'T3' },
  };
  const layoutOf = (plan: unknown) =>
    Object.fromEntries(
      (plan as { slots: Array<{ date: string; sessionKey: string | null }> }).slots.map((slot) => [
        slot.date,
        slot.sessionKey,
      ]),
    );

  it('pergunta antes de mexer: mostra as duas saídas e não grava nada', async () => {
    const { service, input, apply, store } = make({
      ctx: context(JOAO, TUE),
      parsed: parsed({ action: 'TREINAR', date: WED, sessionKey: 'T2' }),
    });
    const outcome = await service.handle(input());
    expect(apply).not.toHaveBeenCalled();
    const reply = text(outcome);
    expect(reply).toContain('Pular');
    expect(reply).toContain('Empurrar');
    expect(reply).toContain('É só responder 1 ou 2');
    expect(JSON.parse(store.get('schedule-flow:state') ?? '{}')).toMatchObject({
      conflict: { displacedKey: 'T3', request: { kind: 'TRAIN_ON', date: WED, sessionKey: 'T2' } },
    });
  });

  it('"2": empurra os treinos até o próximo descanso, sem deixar nenhum de fora', async () => {
    const { service, input, apply, store } = make({
      ctx: context(JOAO, TUE),
      state: conflictState,
    });
    await service.handle({ ...input(), message: '2' });
    const plan = apply.mock.calls[0]?.[2] as unknown as { dropped: string[] };
    expect(plan.dropped).toEqual([]);
    expect(layoutOf(plan)).toMatchObject({ [TUE]: null, [WED]: 'T2', [THU]: 'T3', [FRI]: 'T4' });
    expect(store.has('schedule-flow:state')).toBe(false);
  });

  it('"pula": o treino do dia fica de fora e o resto não muda', async () => {
    const { service, input, apply } = make({ ctx: context(JOAO, TUE), state: conflictState });
    const outcome = await service.handle({ ...input(), message: 'pula o de quarta' });
    const plan = apply.mock.calls[0]?.[2] as unknown as { dropped: string[] };
    expect(plan.dropped).toEqual(['T3']);
    expect(layoutOf(plan)).toMatchObject({ [WED]: 'T2', [THU]: 'T4' });
    expect(text(outcome)).toContain('fica de fora desta semana');
  });

  it('resposta em linguagem livre: a IA lê a escolha (conflict)', async () => {
    const { service, input, apply } = make({
      ctx: context(JOAO, TUE),
      state: conflictState,
      parsed: parsed({ action: 'ESCOLHA', conflict: 'SKIP' }),
    });
    await service.handle({ ...input(), message: 'o que você achar melhor, deixa o de quarta' });
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it('resposta que não escolhe nada: repete a pergunta sem aplicar', async () => {
    const { service, input, apply } = make({
      ctx: context(JOAO, TUE),
      state: conflictState,
      parsed: parsed({ action: 'ESCOLHA', conflict: null }),
    });
    const outcome = await service.handle({ ...input(), message: 'hmm' });
    expect(apply).not.toHaveBeenCalled();
    expect(text(outcome)).toContain('Me conta com qual dia');
  });

  it.each([
    ['1', 'SKIP'],
    ['Opção 1', 'SKIP'],
    ['pula esse', 'SKIP'],
    ['2', 'PUSH'],
    ['pode empurrar tudo', 'PUSH'],
    ['a segunda', 'PUSH'],
    ['talvez', null],
  ])('quickConflictAnswer("%s") = %s', (message, expected) => {
    expect(quickConflictAnswer(message)).toBe(expected);
  });
});

describe('limites físicos', () => {
  it('semana toda feita: parabeniza e não cria treino extra', async () => {
    const { service, input, apply } = make({
      ctx: context(GABRIEL, SAT, {
        [THU]: { status: 'COMPLETED', sessionKey: 'Treino A' },
        [FRI]: { status: 'COMPLETED', sessionKey: 'Treino B' },
        [SUN]: { status: 'COMPLETED', sessionKey: 'Treino C' },
      }),
      parsed: parsed({ action: 'TREINAR', date: SAT }),
    });
    const outcome = await service.handle(input());
    expect(apply).not.toHaveBeenCalled();
    expect(text(outcome)).toContain('fechou os 3 treinos desta semana');
  });

  it('dia que já passou é recusado com a saída do registro tardio', async () => {
    const { service, input } = make({
      ctx: context(GABRIEL, TUE),
      parsed: parsed({ action: 'TREINAR', date: MON, sessionKey: 'Treino A' }),
    });
    expect(text(await service.handle(input()))).toContain(
      'me avise que eu te mando o link para registrar',
    );
  });

  it('reorganização com dois treinos no mesmo dia pede para o aluno repetir', async () => {
    const { service, input } = make({
      ctx: context(JOAO, TUE),
      parsed: parsed({
        action: 'REORGANIZAR',
        placements: [
          { sessionKey: 'T3', date: FRI },
          { sessionKey: 'T4', date: FRI },
        ],
      }),
    });
    expect(text(await service.handle(input()))).toContain('eu só consigo colocar um por dia');
  });

  it('reorganizar sem dizer onde fica nada: se abstém e deixa a IA responder', async () => {
    const { service, input } = make({
      ctx: context(JOAO, TUE),
      parsed: parsed({ action: 'REORGANIZAR' }),
    });
    expect(await service.handle(input())).toEqual({ kind: 'NOT_HANDLED' });
  });

  it('dor aberta, atendimento pausado e quantidade de ajustes não bloqueiam: nenhuma dessas consultas existe', async () => {
    // O fluxo só depende de agenda, link e leitura do pedido: sem nenhuma checagem clínica.
    const { service, input, apply } = make({
      ctx: context(JOAO, TUE),
      parsed: parsed({ action: 'DESCANSAR', date: WED }),
    });
    await service.handle(input());
    await service.handle({ ...input(), operationId: 'op-456' });
    expect(apply).toHaveBeenCalled();
  });
});

describe('desfazer', () => {
  it('desfaz o último ajuste e mostra a semana como estava', async () => {
    const { service, input, undoLast } = make({
      ctx: context(GABRIEL, TUE),
      parsed: parsed({ action: 'DESFAZER' }),
      undo: { status: 'UNDONE', restored: [{ date: THU, sessionKey: 'Treino A' }] },
    });
    const outcome = await service.handle(input());
    expect(undoLast).toHaveBeenCalledWith(USER_ID, expect.any(Date));
    expect(text(outcome)).toContain('voltei como estava');
  });

  it('se hoje voltou a ter treino, manda link novo (o antigo pode apontar para o treino errado)', async () => {
    const { service, input, prepare } = make({
      ctx: context(GABRIEL, THU),
      parsed: parsed({ action: 'DESFAZER' }),
      undo: { status: 'UNDONE', restored: [{ date: THU, sessionKey: 'Treino A' }] },
    });
    const outcome = await service.handle({ ...input(), now: new Date('2026-10-22T18:30:00.000Z') });
    expect(prepare).toHaveBeenCalledWith(USER_ID, 'ON_DEMAND', expect.any(Date));
    expect(text(outcome)).toContain(SEP);
  });

  it.each([['NOTHING_TO_UNDO'], ['ALREADY_USED']] as const)(
    'explica quando não dá (%s)',
    async (status) => {
      const { service, input } = make({
        ctx: context(GABRIEL, TUE),
        parsed: parsed({ action: 'DESFAZER' }),
        undo: { status },
      });
      const outcome = await service.handle(input());
      expect(outcome).toMatchObject({ kind: 'FIXED', adjusted: false });
    },
  );
});

describe('pedido do link do check-in diário', () => {
  it('reenvia o link na hora, sem chamar a IA', async () => {
    const { service, input, parse, prepare } = make({ ctx: context(GABRIEL, THU) });
    const outcome = await service.handle(input('PEDIDO_LINK_TREINO'));
    expect(parse).not.toHaveBeenCalled();
    expect(prepare).toHaveBeenCalledWith(USER_ID, 'RESEND', expect.any(Date));
    expect(text(outcome)).toBe('Boa tarde, *Ana*! link do treino');
  });

  it.each([
    [{ status: 'NO_WORKOUT_TODAY' }, 'dia de descanso'],
    [{ status: 'ALREADY_DONE', focus: 'Pernas' }, 'já está registrado'],
    [{ status: 'THROTTLED' }, 'acabou de ir para você'],
    [{ status: 'NO_PROTOCOL' }, 'Ainda não encontrei um treino ativo'],
  ] as const)('responde ao caso %j', async (link, expected) => {
    const { service, input } = make({ ctx: context(GABRIEL, TUE), link: link as PreparedLink });
    expect(text(await service.handle(input('PEDIDO_LINK_TREINO')))).toContain(expected);
  });
});

describe('sem protocolo ativo e intenções alheias', () => {
  it('sem protocolo/assinatura, o pedido de agenda recebe uma resposta honesta', async () => {
    const { service, input } = make({ ctx: null });
    expect(text(await service.handle(input()))).toContain('Ainda não encontrei um treino ativo');
  });

  it('intenção de outro assunto sem fluxo aberto não é tratada', async () => {
    const { service, input, parse } = make({ ctx: context(GABRIEL, TUE) });
    expect(await service.handle(input('MOTIVACAO'))).toEqual({ kind: 'NOT_HANDLED' });
    expect(parse).not.toHaveBeenCalled();
  });

  /**
   * Regressão (Giovana, 21/10): "você consegue me lembrar disso na semana que vem? Antes do
   * treino? Quais foram as cargas?" foi classificado como agenda e respondido com "Me conta com
   * qual dia você quer mexer?". Sem pedido de agenda executável e sem pergunta em aberto, o
   * serviço se abstém e a resposta segue para a IA.
   */
  it('a IA devolveu OUTRO numa intenção de agenda sem fluxo aberto: se abstém', async () => {
    const { service, input } = make({
      ctx: context(GABRIEL, TUE),
      parsed: parsed({ action: 'OUTRO' }),
    });
    expect(await service.handle(input())).toEqual({ kind: 'NOT_HANDLED' });
  });

  it('escolha de treino sem pergunta de "qual fica de fora" aberta: se abstém', async () => {
    const { service, input } = make({
      ctx: context(GABRIEL, TUE),
      parsed: parsed({ action: 'ESCOLHA', leaveOut: [{ sessionKey: 'T2' }] }),
    });
    expect(await service.handle(input())).toEqual({ kind: 'NOT_HANDLED' });
  });
});

describe('oferta de link novo (treino de hoje atualizado depois do link das 04:00)', () => {
  it.each([
    ['sim', 'YES'],
    ['Sim!', 'YES'],
    ['pode sim', 'YES'],
    ['pode mandar', 'YES'],
    ['quero', 'YES'],
    ['claro, manda', 'YES'],
    ['ok', 'YES'],
    ['por favor', 'YES'],
    ['não', 'NO'],
    ['nao precisa', 'NO'],
    ['não quero', 'NO'],
    ['deixa assim', 'NO'],
    ['n', 'NO'],
    ['qual o treino de amanhã?', null],
    ['simplesmente obrigado', null],
    ['', null],
  ] as const)('"%s" → %s', (message, expected) => {
    expect(answerToOffer(message)).toBe(expected);
  });

  it('"sim": envia o link novo na hora (motivo REFRESH), invalida a oferta e não gasta IA', async () => {
    const { service, input, prepare, parse, store } = make({
      ctx: context(GABRIEL, THU),
      offer: true,
    });
    const outcome = await service.handle({ ...input('PAPO_CASUAL'), message: 'sim, pode mandar' });
    expect(prepare).toHaveBeenCalledWith(USER_ID, 'REFRESH', expect.any(Date));
    expect(parse).not.toHaveBeenCalled();
    expect(text(outcome)).toBe('Boa tarde, *Ana*! link do treino');
    expect(store.has('workout-refresh:offer')).toBe(false);
  });

  it('"não": confirma que o link atual continua valendo e não gera link', async () => {
    const { service, input, prepare, store } = make({ ctx: context(GABRIEL, THU), offer: true });
    const outcome = await service.handle({ ...input('PAPO_CASUAL'), message: 'não precisa' });
    expect(prepare).not.toHaveBeenCalled();
    expect(text(outcome)).toContain('O seu link continua valendo');
    expect(store.has('workout-refresh:offer')).toBe(false);
  });

  it('outro assunto: segue o roteamento normal e a oferta continua esperando', async () => {
    const { service, input, prepare, parse, store } = make({
      ctx: context(GABRIEL, THU),
      offer: true,
    });
    const outcome = await service.handle({
      ...input('DUVIDA_TECNICA'),
      message: 'como faço o agachamento?',
    });
    expect(outcome).toEqual({ kind: 'NOT_HANDLED' });
    expect(prepare).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
    expect(store.has('workout-refresh:offer')).toBe(true);
  });

  it('"sim", mas o aluno já começou o treino: explica que vale a partir do próximo', async () => {
    const { service, input } = make({
      ctx: context(GABRIEL, THU),
      offer: true,
      link: { status: 'ALREADY_STARTED' },
    });
    const outcome = await service.handle({ ...input('PAPO_CASUAL'), message: 'sim' });
    expect(text(outcome)).toContain('em andamento');
  });

  it('pedir o link por conta própria resolve a oferta pendente', async () => {
    const { service, input, store } = make({ ctx: context(GABRIEL, THU), offer: true });
    await service.handle(input('PEDIDO_LINK_TREINO'));
    expect(store.has('workout-refresh:offer')).toBe(false);
  });

  it('a oferta conta como fluxo aberto (tem prioridade sobre a intenção classificada)', async () => {
    const { service } = make({ ctx: context(GABRIEL, THU), offer: true });
    expect(await service.hasOpenFlow(USER_ID)).toBe(true);
    expect(await make({ ctx: context(GABRIEL, THU) }).service.hasOpenFlow(USER_ID)).toBe(false);
  });
});

describe('registro tardio pelo Coach', () => {
  const ready: LateLogResult = {
    status: 'READY',
    workoutId: 'w-late',
    date: MON,
    sessionKey: 'Treino A',
    focus: 'Costas e Bíceps',
  };

  it('"treinei ontem e não consegui registrar": abre o registro e manda o link do dia', async () => {
    const { service, input, begin, prepareLateLog, parse } = make({
      ctx: context(GABRIEL, TUE),
      parsed: parsed({ action: 'REGISTRAR', date: MON }),
      lateLog: ready,
    });
    const outcome = await service.handle(input());
    expect(begin).toHaveBeenCalledWith(USER_ID, { date: MON }, expect.any(Date));
    expect(prepareLateLog).toHaveBeenCalledWith(USER_ID, ready, expect.any(Date));
    expect(text(outcome)).toBe('Boa tarde, *Ana*! link do registro');
    // Registrar o treino responde à pergunta do Coach sobre o treino sem registro.
    expect(outcome).toMatchObject({ adjusted: true });
    expect(parse.mock.calls[0]?.[0]).toMatchObject({
      recentDays: [
        { date: MON, weekday: 'segunda' },
        { date: '2026-10-18', weekday: 'domingo' },
      ],
    });
  });

  it('o aluno diz qual treino fez', async () => {
    const { service, input, begin } = make({
      ctx: context(GABRIEL, TUE),
      parsed: parsed({ action: 'REGISTRAR', date: MON, sessionKey: 'Treino B' }),
      lateLog: ready,
    });
    await service.handle(input());
    expect(begin).toHaveBeenCalledWith(
      USER_ID,
      { date: MON, sessionKey: 'Treino B' },
      expect.any(Date),
    );
  });

  it('sem dizer o dia, pergunta qual (sem abrir nada)', async () => {
    const { service, input, begin } = make({
      ctx: context(GABRIEL, TUE),
      parsed: parsed({ action: 'REGISTRAR' }),
    });
    expect(text(await service.handle(input()))).toContain('Qual dia você treinou?');
    expect(begin).not.toHaveBeenCalled();
  });

  it('dia sem treino previsto: pergunta qual treino fez e guarda o dia para a resposta', async () => {
    const options = [
      { key: 'Treino A', focus: 'Costas e Bíceps' },
      { key: 'Treino B', focus: 'Pernas' },
    ];
    const first = make({
      ctx: context(GABRIEL, TUE),
      parsed: parsed({ action: 'REGISTRAR', date: MON }),
      lateLog: { status: 'NEEDS_SESSION', options },
    });
    const question = text(await first.service.handle(first.input()));
    expect(question).toContain('Qual treino você fez nesse dia?');
    expect(question).toContain('• Treino A (Costas e Bíceps)');
    expect(JSON.parse(first.store.get('schedule-flow:state') as string)).toMatchObject({
      lateLog: { date: MON },
    });

    // A resposta ("o B") chega sem data: usa a guardada.
    const second = make({
      ctx: context(GABRIEL, TUE),
      state: { followUps: 1, lateLog: { date: MON, options } },
      parsed: parsed({ action: 'OUTRO', sessionKey: 'Treino B' }),
      lateLog: ready,
    });
    const outcome = await second.service.handle({ ...second.input('PAPO_CASUAL'), message: 'o B' });
    expect(second.begin).toHaveBeenCalledWith(
      USER_ID,
      { date: MON, sessionKey: 'Treino B' },
      expect.any(Date),
    );
    expect(text(outcome)).toContain('link do registro');
    expect(second.store.has('schedule-flow:state')).toBe(false);
  });

  it.each([
    [{ status: 'OUT_OF_WINDOW' }, 'até 2 dias atrás'],
    [{ status: 'ALREADY_LOGGED', focus: 'Pernas' }, 'já está registrado'],
    [{ status: 'NO_PROTOCOL' }, 'Ainda não encontrei um treino ativo'],
  ] as const)('responde ao caso %j', async (lateLog, expected) => {
    const { service, input } = make({
      ctx: context(GABRIEL, TUE),
      parsed: parsed({ action: 'REGISTRAR', date: MON }),
      lateLog: lateLog as LateLogResult,
    });
    expect(text(await service.handle(input()))).toContain(expected);
  });

  it('falha ao montar o link: resposta honesta, sem prometer', async () => {
    const { service, input } = make({
      ctx: context(GABRIEL, TUE),
      parsed: parsed({ action: 'REGISTRAR', date: MON }),
      lateLog: ready,
      lateLinkText: null,
    });
    expect(text(await service.handle(input()))).toContain('Ainda não encontrei um treino ativo');
  });
});

describe('data que a regra não aceita (D7)', () => {
  it('"o A na quinta da semana que vem": recusa explicando, sem aplicar nada e sem link', async () => {
    const { service, input, apply, prepare } = make({
      ctx: context(GABRIEL, TUE),
      parsed: parsed({ action: 'TREINAR', sessionKey: 'Treino A', invalidDate: '2026-10-29' }),
    });
    const outcome = await service.handle(input());
    expect(apply).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(text(outcome)).toContain('até domingo');
    expect(outcome).toMatchObject({ adjusted: false });
  });

  it('descansar numa data inválida não transforma o treino de HOJE em descanso', async () => {
    const { service, input, apply } = make({
      ctx: context(JOAO, TUE),
      parsed: parsed({ action: 'DESCANSAR', invalidDate: '2026-11-02' }),
    });
    const outcome = await service.handle(input());
    expect(apply).not.toHaveBeenCalled();
    expect(text(outcome)).toContain('até domingo');
  });

  it('dia antigo (antes desta semana) recebe a recusa de dia que já passou', async () => {
    const { service, input, apply } = make({
      ctx: context(GABRIEL, TUE),
      parsed: parsed({ action: 'TREINAR', sessionKey: 'Treino A', invalidDate: '2026-10-12' }),
    });
    expect(text(await service.handle(input()))).toContain('Esse dia já passou');
    expect(apply).not.toHaveBeenCalled();
  });

  it('reorganizar com uma colocação em data inválida recusa o pedido inteiro, não aplica o resto', async () => {
    const { service, input, apply } = make({
      ctx: context(JOAO, TUE),
      parsed: parsed({
        action: 'REORGANIZAR',
        placements: [{ sessionKey: 'T3', date: FRI }],
        invalidDate: '2026-10-30',
      }),
    });
    await service.handle(input());
    expect(apply).not.toHaveBeenCalled();
  });

  it('registrar treino de uma data inválida usa a recusa da janela de registro', async () => {
    const { service, input, begin } = make({
      ctx: context(GABRIEL, TUE),
      parsed: parsed({ action: 'REGISTRAR', invalidDate: '2026-10-05' }),
    });
    expect(text(await service.handle(input()))).toContain('até 2 dias atrás');
    expect(begin).not.toHaveBeenCalled();
  });

  it('data inválida num pedido que não depende de dia (desfazer, link) não atrapalha', async () => {
    const { service, input, undoLast } = make({
      ctx: context(GABRIEL, TUE),
      parsed: parsed({ action: 'DESFAZER', invalidDate: '2026-10-29' }),
      undo: { status: 'NOTHING_TO_UNDO' },
    });
    await service.handle(input());
    expect(undoLast).toHaveBeenCalled();
  });
});

describe('falha ao gerar o link com o ajuste já gravado (O5)', () => {
  function failingLinks() {
    const m = make({
      ctx: context(GABRIEL, TUE),
      parsed: parsed({ action: 'TREINAR', sessionKey: 'Treino A' }),
    });
    m.prepare.mockRejectedValue(new Error('shortlink fora'));
    return m;
  }

  it('o aluno recebe a confirmação e a orientação, o job não estoura', async () => {
    const { service, input, apply } = failingLinks();
    const outcome = await service.handle(input());
    expect(apply).toHaveBeenCalledTimes(1);
    const bubbles = text(outcome).split(SEP);
    expect(bubbles[0]).toContain('desfazer');
    expect(bubbles[1]).toContain('Não consegui gerar o link agora');
    expect(outcome).toMatchObject({ adjusted: true });
  });

  it('pedido do link que falha responde com a orientação, não com erro', async () => {
    const { service, input, prepare } = make({ ctx: context(GABRIEL, THU) });
    prepare.mockRejectedValue(new Error('redis fora'));
    expect(text(await service.handle(input('PEDIDO_LINK_TREINO')))).toContain(
      'Não consegui gerar o link agora',
    );
  });

  it('"sim" à oferta que falha mantém a oferta aberta para um novo "sim"', async () => {
    const { service, input, prepare, store } = make({ ctx: context(GABRIEL, THU), offer: true });
    prepare.mockRejectedValueOnce(new Error('timeout'));
    const first = await service.handle({ ...input('PAPO_CASUAL'), message: 'sim' });
    expect(text(first)).toContain('Não consegui gerar o link agora');
    expect(store.has('workout-refresh:offer')).toBe(true);

    const second = await service.handle({ ...input('PAPO_CASUAL'), message: 'sim' });
    expect(text(second)).toBe('Boa tarde, *Ana*! link do treino');
    expect(store.has('workout-refresh:offer')).toBe(false);
  });

  it('registro tardio com o link falhando: registro aberto e orientação para pedir de novo', async () => {
    const { service, input, prepareLateLog } = make({
      ctx: context(GABRIEL, TUE),
      parsed: parsed({ action: 'REGISTRAR', date: MON }),
      lateLog: {
        status: 'READY',
        workoutId: 'w-late',
        date: MON,
        sessionKey: 'Treino A',
        focus: 'Costas e Bíceps',
      },
    });
    prepareLateLog.mockRejectedValue(new Error('shortlink fora'));
    const outcome = await service.handle(input());
    expect(text(outcome)).toContain('O registro do seu treino já está aberto');
    expect(outcome).toMatchObject({ adjusted: true });
  });

  it('desfazer com o link falhando ainda confirma que voltou como estava', async () => {
    const { service, input, prepare } = make({
      ctx: context(GABRIEL, THU),
      parsed: parsed({ action: 'DESFAZER' }),
      undo: { status: 'UNDONE', restored: [{ date: THU, sessionKey: 'Treino A' }] },
    });
    prepare.mockRejectedValue(new Error('timeout'));
    const bubbles = text(
      await service.handle({ ...input(), now: new Date('2026-10-22T18:30:00.000Z') }),
    ).split(SEP);
    expect(bubbles[0]).toContain('voltei como estava');
    expect(bubbles[1]).toContain('Não consegui gerar o link agora');
  });
});

describe('recusa por cota (D5)', () => {
  it('semana cheia de treinos MARCADOS: não parabeniza, explica que um precisa ficar de fora', async () => {
    // Cota 3, os três ainda por fazer; pedir um treino que não está na semana (deixado de fora antes).
    const reduced = context(GABRIEL, TUE, {}, new Map([[SUN, null]]));
    reduced.quota = 2;
    const { service, input, apply } = make({
      ctx: reduced,
      parsed: parsed({ action: 'TREINAR', sessionKey: 'Treino C' }),
    });
    const reply = text(await service.handle(input()));
    expect(apply).not.toHaveBeenCalled();
    expect(reply).toContain('já está com os 2 treinos marcados');
    expect(reply).not.toContain('parabéns');
  });
});

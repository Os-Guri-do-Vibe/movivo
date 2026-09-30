/**
 * Fluxo de substituição de exercício (achado 2026-09-30): alcance "só hoje" x "no protocolo",
 * troca em lote e estado explícito em Redis. As chamadas de LLM (identificar alvos, ler o
 * turno, procurar exercício fora da lista) são dubladas; a curadoria de segurança, o catálogo e
 * a montagem das mensagens são os reais.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ProtocolStructure } from '@movivo/shared';

import { ExerciseCatalogProvider } from '../protocol/exercise-catalog-provider.service';
import { findSafeCandidates, isPlausibleSubstitution } from '../protocol/exercise-substitution';
import type { ActiveProtocolForSubstitution } from '../protocol/protocol-substitution.repository';
import {
  SUBSTITUTION_ALREADY_PENDING_MESSAGE,
  SUBSTITUTION_CATALOG_GAP_MESSAGE,
  SUBSTITUTION_FALLBACK_MESSAGE,
  SUBSTITUTION_FORCED_TODAY_NOTE,
  SUBSTITUTION_GAVE_UP_MESSAGE,
  SUBSTITUTION_NOT_SAFE_TO_APPLY_MESSAGE,
  SUBSTITUTION_PROTOCOL_PART_PENDING_NOTE,
  SUBSTITUTION_SCOPE_QUESTION_MULTI,
  SUBSTITUTION_SCOPE_QUESTION_SINGLE,
  SUBSTITUTION_TODAY_NOTE,
  SUBSTITUTION_TOO_MANY_MESSAGE,
} from './coach-messages';
import {
  MAX_SUBSTITUTION_FOLLOW_UPS,
  SUBSTITUTION_FLOW_TTL_SECONDS,
  SubstitutionFlowService,
  type FlowInput,
  type FlowOutcome,
} from './substitution-flow.service';
import type { ResolveTurnRequest, SubstitutionScope } from './substitution-resolution.service';

const CATALOG = new ExerciseCatalogProvider();
const ALL = CATALOG.getAll();
const byId = (id: string) => {
  const found = ALL.find((ex) => ex.id === id);
  if (!found) throw new Error(`fixture: "${id}" ausente do catálogo`);
  return found;
};

const CONSTRAINTS = {
  level: 'INICIANTE',
  location: 'HOME',
  equipment: [],
  injuryTags: [],
} as const;

function prescribed(exerciseId: string) {
  const ex = byId(exerciseId);
  return {
    exerciseId,
    name: ex.name,
    sets: 3,
    reps: { min: 8, max: 12 },
    loadStrategy: 'BODYWEIGHT' as const,
    restSeconds: 60,
  };
}

const CONTENT = {
  promptVersion: 'v1',
  goal: 'GAIN_MUSCLE',
  phase: 'ADAPTACAO',
  phaseDurationWeeks: 3,
  weeklyFrequency: 2,
  sessions: [
    {
      dayLabel: 'Dia A',
      focus: 'Peito',
      exercises: [prescribed('flexao'), prescribed('flexao_diamante')],
    },
    {
      dayLabel: 'Dia B',
      focus: 'Pernas',
      exercises: [prescribed('agachamento_goblet'), prescribed('afundo')],
    },
  ],
} as unknown as ProtocolStructure;

const ACTIVE: ActiveProtocolForSubstitution = {
  protocolId: 'proto1',
  version: 3,
  content: CONTENT,
  constraints: CONSTRAINTS,
  validationConstraints: { goal: 'GAIN_MUSCLE', injuryTags: [], level: 'INICIANTE' },
  parQFlags: [],
  fromBlockingParq: false,
};

const DIAMANTE = byId('flexao_diamante');
const AFUNDO = byId('afundo');
/** Opções reais, na ordem em que a curadoria as apresenta (sem as que já estão na sessão). */
const curationOf = (target: typeof DIAMANTE) =>
  findSafeCandidates(target, CONSTRAINTS, ALL).filter(
    (c) => !CONTENT.sessions.some((s) => s.exercises.some((e) => e.exerciseId === c.id)),
  );
const DIAMANTE_OPTIONS = curationOf(DIAMANTE);
const AFUNDO_OPTIONS = curationOf(AFUNDO);
if (DIAMANTE_OPTIONS.length < 2) throw new Error('fixture: flexao_diamante precisa de 2+ opções');
if (AFUNDO_OPTIONS.length < 5) throw new Error('fixture: afundo precisa de 5+ opções (2 lotes)');
const [D1, D2] = DIAMANTE_OPTIONS;
const [A1, A2, A3, A4, A5] = AFUNDO_OPTIONS;
if (!D1 || !D2 || !A1 || !A2 || !A3 || !A4 || !A5) throw new Error('fixture');

type Read = Partial<{
  chosen: string | null;
  scope: SubstitutionScope | null;
  rejectedOffered: boolean;
  requestedOutsideList: boolean;
}>;

interface Options {
  active?: ActiveProtocolForSubstitution | null;
  hasPending?: boolean;
  identified?:
    { identified: true; exerciseIds: string[] } | { identified: false; tooMany: boolean };
  createResult?: { created: true; id: string } | { created: false; alreadyPending: true };
  /** Estruturas com algum destes exercícios reprovam na validação do protocolo inteiro. */
  failValidationWith?: string[];
  lookup?: { requestedName: string | null; matchedExerciseId: string | null };
}

function harness(opts: Options = {}) {
  const store = new Map<string, string>();
  const redis = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
  };
  const keys = {
    forUser: (userId: string, ...parts: string[]) => ['k', userId, ...parts].join(':'),
  };
  const repo = {
    loadActiveProtocol: vi.fn(async () => (opts.active === undefined ? ACTIVE : opts.active)),
    hasPending: vi.fn(async () => opts.hasPending ?? false),
    createPending: vi.fn(async () => opts.createResult ?? { created: true, id: 'req1' }),
  };
  const target = {
    identify: vi.fn(
      async () => opts.identified ?? { identified: true, exerciseIds: [DIAMANTE.id] },
    ),
  };
  const resolveTurn = vi.fn();
  const lookup = {
    identify: vi.fn(async () => opts.lookup ?? { requestedName: null, matchedExerciseId: null }),
  };
  const validation = {
    validate: vi.fn(({ structure }: { structure: ProtocolStructure }) => {
      const ids = structure.sessions.flatMap((s) => s.exercises.map((e) => e.exerciseId));
      const broken = (opts.failValidationWith ?? []).some((id) => ids.includes(id));
      return broken
        ? { action: 'BLOCK_FALLBACK', violations: [{ rule: 'ISOLATION_AS_BASE' }] }
        : { action: 'PASS', violations: [] };
    }),
  };
  const context = { build: vi.fn(async () => ({ volatileSuffix: 'Aluno: posso trocar?' })) };
  const queues = { enqueue: vi.fn(async () => 'job') };
  const queueEvents = { emit: vi.fn() };
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const service = new SubstitutionFlowService(
    repo as never,
    target as never,
    { resolveTurn } as never,
    lookup as never,
    CATALOG,
    validation as never,
    context as never,
    queues as never,
    queueEvents as never,
    redis as never,
    keys as never,
    logger as never,
  );

  /** Próxima leitura do turno: por alvo, o que o aluno disse (default: nada). */
  function read(
    perTarget: Record<string, Read> = {},
    extra: { topic?: 'CONTINUE' | 'NEW_TOPIC'; pain?: boolean } = {},
  ) {
    resolveTurn.mockImplementationOnce(async (request: ResolveTurnRequest) => ({
      ok: true,
      topic: extra.topic ?? 'CONTINUE',
      pain: extra.pain ?? false,
      targets: request.targets.map((t) => {
        const r = perTarget[t.targetId] ?? {};
        return {
          targetId: t.targetId,
          chosenExerciseId: r.chosen ?? null,
          scope: r.scope ?? null,
          rejectedOffered: r.rejectedOffered ?? false,
          requestedOutsideList: r.requestedOutsideList ?? false,
        };
      }),
    }));
  }

  const input = (over: Partial<FlowInput> = {}): FlowInput => ({
    userId: 'u1',
    message: 'posso trocar o exercício?',
    scrubUser: {},
    agentName: 'MOVI',
    personaSlot: null,
    operationId: 'op-1',
    entry: 'INTENT',
    ...over,
  });

  const stateKey = 'k:u1:substitution-flow:state';
  return {
    service,
    redis,
    store,
    repo,
    target,
    resolveTurn,
    lookup,
    validation,
    queues,
    queueEvents,
    read,
    input,
    stateKey,
  };
}

function generate(outcome: FlowOutcome) {
  if (outcome.kind !== 'GENERATE') throw new Error(`esperava GENERATE, veio ${outcome.kind}`);
  return outcome;
}
function fixed(outcome: FlowOutcome) {
  if (outcome.kind !== 'FIXED') throw new Error(`esperava FIXED, veio ${outcome.kind}`);
  return outcome;
}

describe('SubstitutionFlowService — pergunta de alcance (só hoje x protocolo)', () => {
  it('sem alcance dito: oferece as opções seguras e SEMPRE pergunta o alcance, sem persistir nada', async () => {
    const h = harness();
    h.read();
    const out = generate(await h.service.handle(h.input()));

    expect(out.extraSystem).toContain(D1.name);
    expect(out.extraSystem).toContain('NÃO pergunte se a troca é só para hoje');
    // A pergunta é texto FIXO acrescentado depois — nunca depende de o LLM lembrar dela.
    expect(out.suffix).toBe(SUBSTITUTION_SCOPE_QUESTION_SINGLE);
    expect(out.allowedExercises).toEqual(expect.arrayContaining([DIAMANTE.name, D1.id, D1.name]));
    expect(h.repo.createPending).not.toHaveBeenCalled();
    expect(h.queues.enqueue).not.toHaveBeenCalled();
    expect(h.queueEvents.emit).not.toHaveBeenCalled();
    // O estado fica em Redis com TTL, e guarda exatamente o que foi oferecido.
    expect(h.redis.set).toHaveBeenCalledWith(
      h.stateKey,
      expect.any(String),
      'EX',
      SUBSTITUTION_FLOW_TTL_SECONDS,
    );
    const state = JSON.parse(h.store.get(h.stateKey) ?? '{}');
    expect(state.targets[0]).toMatchObject({ exerciseId: DIAMANTE.id, scope: null, chosen: null });
    expect(state.targets[0].offeredIds).toEqual(DIAMANTE_OPTIONS.slice(0, 3).map((c) => c.id));
  });

  it('o aluno já disse "hoje" e nomeou o substituto: recomenda direto, sem perguntar e sem persistir', async () => {
    const h = harness();
    h.read({ [DIAMANTE.id]: { chosen: D1.id, scope: 'TODAY' } });
    const out = generate(await h.service.handle(h.input()));

    expect(out.extraSystem).toContain('SÓ PARA HOJE');
    expect(out.extraSystem).toContain(`No lugar de "${DIAMANTE.name}"`);
    expect(out.extraSystem).toContain(`fazer "${D1.name}"`);
    // Mantém a prescrição do exercício original (séries, repetições e descanso).
    expect(out.extraSystem).toContain('3 séries de 8 a 12 repetições, descanso de 60s');
    expect(out.suffix).toBe(SUBSTITUTION_TODAY_NOTE);
    expect(out.suffix).not.toContain('protocolo?');
    // "Só hoje" não grava NADA: nem proposta, nem fila do CREF, nem job de liberação.
    expect(h.repo.createPending).not.toHaveBeenCalled();
    expect(h.queues.enqueue).not.toHaveBeenCalled();
    expect(h.queueEvents.emit).not.toHaveBeenCalled();
    expect(h.store.has(h.stateKey)).toBe(false);
  });

  it('o aluno já disse "no meu protocolo" e nomeou o substituto: registra a proposta e agenda a liberação', async () => {
    const h = harness();
    h.read({ [DIAMANTE.id]: { chosen: D1.id, scope: 'PROTOCOL' } });
    const out = generate(await h.service.handle(h.input()));

    expect(out.extraSystem).toContain('CONFIRMADA');
    expect(out.extraSystem).toContain(`"${DIAMANTE.name}" vai virar "${D1.name}"`);
    expect(out.suffix).toBeUndefined();
    expect(h.repo.createPending).toHaveBeenCalledOnce();
    const created = (h.repo.createPending.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(created).toMatchObject({
      userId: 'u1',
      protocolId: 'proto1',
      baseVersion: 3,
      items: [
        {
          fromExerciseId: DIAMANTE.id,
          toExerciseId: D1.id,
          catalogGap: false,
          mandatory: false,
          decision: 'PENDING',
        },
      ],
    });
    expect(h.queues.enqueue).toHaveBeenCalledWith(
      'protocol-substitution-release',
      'substitution-release',
      { userId: 'u1', requestId: 'req1' },
      { delay: 30 * 60 * 1000, jobId: 'substitution-auto-release-req1' },
    );
    expect(h.queueEvents.emit).toHaveBeenCalledWith('protocol');
    expect(h.store.has(h.stateKey)).toBe(false);
  });

  it('dois turnos: pergunta no 1º, a resposta curta "só hoje" (continuação) fecha no 2º', async () => {
    const h = harness();
    h.read();
    await h.service.handle(h.input());
    expect(h.target.identify).toHaveBeenCalledOnce();

    // A resposta pode ter sido classificada como QUALQUER intenção: o fluxo aberto tem prioridade.
    h.read({ [DIAMANTE.id]: { chosen: D2.id, scope: 'TODAY' } });
    const out = generate(
      await h.service.handle(h.input({ entry: 'CONTINUATION', message: 'o segundo, só hoje' })),
    );
    expect(out.extraSystem).toContain(`fazer "${D2.name}"`);
    expect(out.suffix).toBe(SUBSTITUTION_TODAY_NOTE);
    // Continuação não reidentifica o alvo: usa o estado.
    expect(h.target.identify).toHaveBeenCalledOnce();
    expect(h.repo.createPending).not.toHaveBeenCalled();
    expect(h.store.has(h.stateKey)).toBe(false);
  });

  it('escolha e alcance podem chegar em turnos separados', async () => {
    const h = harness();
    h.read({ [DIAMANTE.id]: { chosen: D1.id } });
    const first = generate(await h.service.handle(h.input()));
    // Já escolheu: não reoferece, só pergunta o que falta (o alcance).
    expect(first.extraSystem).toContain(`já escolheu "${D1.name}"`);
    expect(first.suffix).toBe(SUBSTITUTION_SCOPE_QUESTION_SINGLE);

    h.read({ [DIAMANTE.id]: { scope: 'PROTOCOL' } });
    const second = generate(
      await h.service.handle(h.input({ entry: 'CONTINUATION', message: 'no protocolo' })),
    );
    expect(second.extraSystem).toContain('CONFIRMADA');
    expect(h.repo.createPending).toHaveBeenCalledOnce();
  });

  it('o aluno muda de ideia sobre o alcance no meio do caminho', async () => {
    const h = harness();
    // Pediu no protocolo, ainda sem escolher o substituto: o fluxo continua aberto.
    h.read({ [DIAMANTE.id]: { scope: 'PROTOCOL' } });
    const first = generate(await h.service.handle(h.input()));
    expect(first.suffix).toBeUndefined();

    h.read({ [DIAMANTE.id]: { chosen: D1.id, scope: 'TODAY' } });
    const out = generate(
      await h.service.handle(h.input({ entry: 'CONTINUATION', message: 'na real, só hoje' })),
    );
    expect(out.extraSystem).toContain('SÓ PARA HOJE');
    expect(h.repo.createPending).not.toHaveBeenCalled();
  });
});

describe('SubstitutionFlowService — fluxo aberto x mensagens de outro assunto', () => {
  it('continuação sem fluxo aberto: não trata nada nem chama LLM', async () => {
    const h = harness();
    const out = await h.service.handle(h.input({ entry: 'CONTINUATION' }));
    expect(out).toEqual({ kind: 'NOT_HANDLED' });
    expect(h.repo.loadActiveProtocol).not.toHaveBeenCalled();
    expect(h.resolveTurn).not.toHaveBeenCalled();
  });

  it('fluxo aberto, mas a mensagem é de outro assunto: segue o roteamento normal e mantém o estado', async () => {
    const h = harness();
    h.read();
    await h.service.handle(h.input());
    h.read({}, { topic: 'NEW_TOPIC' });
    const out = await h.service.handle(
      h.input({ entry: 'CONTINUATION', message: 'qual a carga ideal do supino?' }),
    );
    expect(out).toEqual({ kind: 'NOT_HANDLED' });
    expect(h.store.has(h.stateKey)).toBe(true);
  });

  it('fluxo aberto e a leitura do turno falha: não sequestra a mensagem', async () => {
    const h = harness();
    h.read();
    await h.service.handle(h.input());
    h.resolveTurn.mockResolvedValueOnce({ ok: false });
    const out = await h.service.handle(h.input({ entry: 'CONTINUATION' }));
    expect(out).toEqual({ kind: 'NOT_HANDLED' });
  });

  it('estado de outra versão do protocolo é descartado', async () => {
    const h = harness();
    h.read();
    await h.service.handle(h.input());
    h.repo.loadActiveProtocol.mockResolvedValueOnce({ ...ACTIVE, version: 4 });
    const out = await h.service.handle(h.input({ entry: 'CONTINUATION' }));
    expect(out).toEqual({ kind: 'NOT_HANDLED' });
    expect(h.store.has(h.stateKey)).toBe(false);
  });

  it('hasOpenFlow e abandon refletem o estado em Redis', async () => {
    const h = harness();
    expect(await h.service.hasOpenFlow('u1')).toBe(false);
    h.read();
    await h.service.handle(h.input());
    expect(await h.service.hasOpenFlow('u1')).toBe(true);
    await h.service.abandon('u1');
    expect(await h.service.hasOpenFlow('u1')).toBe(false);
  });

  it('estado corrompido em Redis é tratado como sem fluxo aberto', async () => {
    const h = harness();
    h.store.set(h.stateKey, '{isso não é json');
    expect(await h.service.hasOpenFlow('u1')).toBe(false);
  });

  it('um pedido novo com OUTRO exercício substitui o fluxo aberto', async () => {
    const h = harness();
    h.read({ [DIAMANTE.id]: { chosen: D1.id } });
    await h.service.handle(h.input());
    h.target.identify.mockResolvedValueOnce({ identified: true, exerciseIds: [AFUNDO.id] });
    h.read();
    const out = generate(await h.service.handle(h.input({ message: 'e o afundo, troca também?' })));
    expect(out.extraSystem).toContain(`"${AFUNDO.name}"`);
    const state = JSON.parse(h.store.get(h.stateKey) ?? '{}');
    expect(state.targets.map((t: { exerciseId: string }) => t.exerciseId)).toEqual([AFUNDO.id]);
  });

  it('o mesmo exercício (ou um subconjunto) continua o fluxo, sem perder a escolha', async () => {
    const h = harness();
    h.read({ [DIAMANTE.id]: { chosen: D1.id } });
    await h.service.handle(h.input());
    h.target.identify.mockResolvedValueOnce({ identified: true, exerciseIds: [DIAMANTE.id] });
    h.read({ [DIAMANTE.id]: { scope: 'TODAY' } });
    const out = generate(await h.service.handle(h.input({ message: 'só hoje' })));
    expect(out.extraSystem).toContain(`fazer "${D1.name}"`);
  });
});

describe('SubstitutionFlowService — alvos', () => {
  it('sem alvo identificado: pergunta qual exercício, sem sugerir substituto', async () => {
    const h = harness({ identified: { identified: false, tooMany: false } });
    const out = generate(await h.service.handle(h.input()));
    expect(out.extraSystem).toContain('sem sugerir nenhuma alternativa');
    expect(out.allowedExercises).toEqual(
      expect.arrayContaining([DIAMANTE.id, DIAMANTE.name, AFUNDO.id, AFUNDO.name]),
    );
    // Só o que já está no protocolo: nenhum candidato novo pode ser nomeado aqui.
    expect(out.allowedExercises).not.toContain(D1.name);
    expect(h.resolveTurn).not.toHaveBeenCalled();
  });

  it('mais de 3 exercícios: pede pra priorizar e alerta o profissional', async () => {
    const h = harness({ identified: { identified: false, tooMany: true } });
    const out = fixed(await h.service.handle(h.input()));
    expect(out.text).toBe(SUBSTITUTION_TOO_MANY_MESSAGE);
    expect(out.humanReview).toBe(true);
    expect(out.handoffReason).toBe('SUBSTITUTION_TOO_MANY');
  });

  it('sem protocolo ativo: fallback honesto com revisão humana (continuação não trata nada)', async () => {
    const h = harness({ active: null });
    const out = fixed(await h.service.handle(h.input()));
    expect(out.text).toBe(SUBSTITUTION_FALLBACK_MESSAGE);
    expect(out.humanReview).toBe(true);
    expect(await h.service.handle(h.input({ entry: 'CONTINUATION' }))).toEqual({
      kind: 'NOT_HANDLED',
    });
  });

  it('alvo sem nenhum substituto seguro na base: fallback, sem LLM generativo', async () => {
    // Curadoria vazia: toda troca possível reprova na validação (o protocolo original passa).
    const h = harness({
      identified: { identified: true, exerciseIds: [DIAMANTE.id] },
      failValidationWith: DIAMANTE_OPTIONS.map((c) => c.id),
    });
    h.read();
    const out = fixed(await h.service.handle(h.input()));
    expect(out.text).toBe(SUBSTITUTION_FALLBACK_MESSAGE);
    expect(out.humanReview).toBe(true);
    expect(h.store.has(h.stateKey)).toBe(false);
  });
});

describe('SubstitutionFlowService — curadoria', () => {
  it('nunca oferece candidato que já está na mesma sessão do exercício trocado', async () => {
    const h = harness();
    h.read();
    const out = generate(await h.service.handle(h.input()));
    // `flexao` está na mesma sessão que `flexao_diamante`.
    expect(out.extraSystem).not.toContain('OPÇÕES SEGURAS DA BASE: Flexão,');
    expect(out.allowedExercises.filter((name) => name === byId('flexao').name)).toHaveLength(0);
  });

  it('descarta candidato que quebraria a validação do protocolo inteiro (antes de oferecer)', async () => {
    const h = harness({ failValidationWith: [D1.id] });
    h.read();
    const out = generate(await h.service.handle(h.input()));
    expect(out.extraSystem).not.toContain(D1.name);
    expect(out.extraSystem).toContain(D2.name);
  });

  it('protocolo que já reprova sozinho não esvazia a oferta (a pré-validação não discrimina)', async () => {
    const h = harness({ failValidationWith: ['flexao'] });
    h.read();
    const out = generate(await h.service.handle(h.input()));
    expect(out.extraSystem).toContain(D1.name);
  });

  it('escolha que não está no conjunto seguro recomputado é ignorada', async () => {
    const h = harness();
    h.read({ [DIAMANTE.id]: { chosen: byId('agachamento_goblet').id, scope: 'TODAY' } });
    const out = generate(await h.service.handle(h.input()));
    // Sem escolha válida: reoferece em vez de recomendar algo fora da curadoria.
    expect(out.extraSystem).toContain('OPÇÕES SEGURAS DA BASE');
    expect(out.suffix).toBeUndefined();
  });

  it('lote rejeitado: oferece o PRÓXIMO lote de 3', async () => {
    const h = harness({ identified: { identified: true, exerciseIds: [AFUNDO.id] } });
    h.read();
    const first = generate(await h.service.handle(h.input()));
    for (const c of [A1, A2, A3]) expect(first.extraSystem).toContain(c.name);
    expect(first.extraSystem).not.toContain(A4.name);

    h.read({ [AFUNDO.id]: { rejectedOffered: true } });
    const second = generate(
      await h.service.handle(h.input({ entry: 'CONTINUATION', message: 'nenhuma dessas' })),
    );
    for (const c of [A4, A5]) expect(second.extraSystem).toContain(c.name);
    expect(second.extraSystem).not.toContain(A1.name);
  });

  it('lote rejeitado e curadoria esgotada: fallback honesto com revisão humana', async () => {
    const h = harness({ identified: { identified: true, exerciseIds: [AFUNDO.id] } });
    h.read();
    await h.service.handle(h.input());
    h.read({ [AFUNDO.id]: { rejectedOffered: true } });
    await h.service.handle(h.input({ entry: 'CONTINUATION' }));
    h.read({ [AFUNDO.id]: { rejectedOffered: true } });
    const out = fixed(await h.service.handle(h.input({ entry: 'CONTINUATION' })));
    expect(out.text).toBe(SUBSTITUTION_FALLBACK_MESSAGE);
    expect(out.humanReview).toBe(true);
    expect(h.store.has(h.stateKey)).toBe(false);
  });
});

describe('SubstitutionFlowService — exercício pedido fora das opções', () => {
  const ineligible = ALL.find(
    (ex) =>
      ex.id !== DIAMANTE.id &&
      isPlausibleSubstitution(DIAMANTE, ex) &&
      !DIAMANTE_OPTIONS.some((c) => c.id === ex.id) &&
      !CONTENT.sessions.some((s) => s.exercises.some((e) => e.exerciseId === ex.id)),
  );
  if (!ineligible) throw new Error('fixture: nenhum exercício plausível porém inelegível');

  it('não existe no catálogo + protocolo: pedido de catálogo, revisão obrigatória, sem liberação automática', async () => {
    const h = harness({
      lookup: { requestedName: 'Supino Reto Máquina', matchedExerciseId: null },
    });
    h.read({ [DIAMANTE.id]: { requestedOutsideList: true, scope: 'PROTOCOL' } });
    const out = fixed(await h.service.handle(h.input()));

    expect(out.text).toBe(SUBSTITUTION_CATALOG_GAP_MESSAGE);
    const created = (h.repo.createPending.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(created).toMatchObject({
      items: [
        {
          fromExerciseId: DIAMANTE.id,
          toExerciseId: null,
          toExerciseName: 'Supino Reto Máquina',
          catalogGap: true,
          mandatory: true,
        },
      ],
      proposedContent: null,
      diff: null,
    });
    // Nunca auto-libera: não há o que aplicar sozinho ainda.
    expect(h.queues.enqueue).not.toHaveBeenCalled();
    expect(h.queueEvents.emit).toHaveBeenCalledWith('protocol');
  });

  it('existe e é plausível, mas inelegível pra este aluno: revisão obrigatória, nunca "confirmada"', async () => {
    const h = harness({
      lookup: { requestedName: ineligible.name, matchedExerciseId: ineligible.id },
    });
    h.read({ [DIAMANTE.id]: { requestedOutsideList: true, scope: 'PROTOCOL' } });
    const out = fixed(await h.service.handle(h.input()));

    expect(out.text).toBe(SUBSTITUTION_NOT_SAFE_TO_APPLY_MESSAGE);
    const created = (h.repo.createPending.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(created).toMatchObject({
      items: [{ toExerciseId: ineligible.id, catalogGap: false, mandatory: true }],
    });
    expect(h.queues.enqueue).not.toHaveBeenCalled();
  });

  it('existe mas não tem nexo fisiológico: orienta na hora, sem registrar na fila', async () => {
    const h = harness({ lookup: { requestedName: AFUNDO.name, matchedExerciseId: AFUNDO.id } });
    h.read({ [DIAMANTE.id]: { requestedOutsideList: true, scope: 'PROTOCOL' } });
    const out = generate(await h.service.handle(h.input()));

    expect(out.extraSystem).toContain('grupo muscular/padrão de movimento diferente');
    expect(out.extraSystem).toContain('NÃO diga que vai registrar/confirmar');
    expect(out.extraSystem).toContain('OPÇÕES SEGURAS DA BASE');
    expect(h.repo.createPending).not.toHaveBeenCalled();
    expect(h.queueEvents.emit).not.toHaveBeenCalled();
  });

  it('pedido de catálogo combinado com "só hoje": não dá pra recomendar, reoferece as opções seguras', async () => {
    const h = harness({
      lookup: { requestedName: 'Supino Reto Máquina', matchedExerciseId: null },
    });
    h.read({ [DIAMANTE.id]: { requestedOutsideList: true, scope: 'TODAY' } });
    const out = generate(await h.service.handle(h.input()));

    expect(out.extraSystem).toContain('só o profissional pode avaliar');
    expect(out.extraSystem).toContain('"Supino Reto Máquina"');
    expect(out.extraSystem).toContain(D1.name);
    expect(h.repo.createPending).not.toHaveBeenCalled();
  });

  it('o "fora da lista" que na verdade é uma opção segura é tratado como escolha normal', async () => {
    const h = harness({ lookup: { requestedName: D2.name, matchedExerciseId: D2.id } });
    h.read({ [DIAMANTE.id]: { requestedOutsideList: true, scope: 'TODAY' } });
    const out = generate(await h.service.handle(h.input()));
    expect(out.extraSystem).toContain(`fazer "${D2.name}"`);
  });
});

describe('SubstitutionFlowService — uma proposta pendente por vez', () => {
  it('há troca em análise e o alcance não foi dito: a recomendação vale só pra hoje, sem perguntar', async () => {
    const h = harness({ hasPending: true });
    h.read({ [DIAMANTE.id]: { chosen: D1.id } });
    const out = generate(await h.service.handle(h.input()));

    expect(out.extraSystem).toContain('SÓ PARA HOJE');
    expect(out.suffix).toBe(SUBSTITUTION_FORCED_TODAY_NOTE);
    expect(out.suffix).not.toContain('protocolo?');
    expect(h.repo.createPending).not.toHaveBeenCalled();
  });

  it('há troca em análise e o aluno pede no protocolo: avisa, sem tentar identificar/oferecer de novo', async () => {
    const h = harness({ hasPending: true });
    h.read({ [DIAMANTE.id]: { chosen: D1.id, scope: 'PROTOCOL' } });
    const out = fixed(await h.service.handle(h.input()));
    expect(out.text).toBe(SUBSTITUTION_ALREADY_PENDING_MESSAGE);
    expect(h.repo.createPending).not.toHaveBeenCalled();
    expect(h.store.has(h.stateKey)).toBe(false);
  });

  it('corrida: outra pendência criada entre a checagem e a gravação → avisa em vez de falhar', async () => {
    const h = harness({ createResult: { created: false, alreadyPending: true } });
    h.read({ [DIAMANTE.id]: { chosen: D1.id, scope: 'PROTOCOL' } });
    const out = fixed(await h.service.handle(h.input()));
    expect(out.text).toBe(SUBSTITUTION_ALREADY_PENDING_MESSAGE);
    expect(h.queues.enqueue).not.toHaveBeenCalled();
  });
});

describe('SubstitutionFlowService — PAR-Q e validação do protocolo inteiro', () => {
  it('origem em PAR-Q bloqueante: persiste, mas NÃO agenda liberação automática', async () => {
    const h = harness({ active: { ...ACTIVE, fromBlockingParq: true } });
    h.read({ [DIAMANTE.id]: { chosen: D1.id, scope: 'PROTOCOL' } });
    await h.service.handle(h.input());
    expect(h.repo.createPending).toHaveBeenCalledOnce();
    expect(h.queues.enqueue).not.toHaveBeenCalled();
  });

  it('validação reprova só no momento de gravar: mensagem segura + revisão humana, nada persistido', async () => {
    const h = harness();
    h.read({ [DIAMANTE.id]: { chosen: D1.id } });
    await h.service.handle(h.input()); // oferta e escolha passam na validação

    // O estado mudou no meio: a troca escolhida passa a quebrar o protocolo inteiro.
    h.validation.validate.mockImplementation(({ structure }: { structure: ProtocolStructure }) => {
      const ids = structure.sessions.flatMap((s) => s.exercises.map((e) => e.exerciseId));
      return ids.includes(D1.id)
        ? { action: 'BLOCK_FALLBACK', violations: [{ rule: 'ISOLATION_AS_BASE' }] }
        : { action: 'PASS', violations: [] };
    });
    h.read({ [DIAMANTE.id]: { scope: 'PROTOCOL' } });
    const out = fixed(
      await h.service.handle(h.input({ entry: 'CONTINUATION', message: 'no protocolo' })),
    );

    expect(out.text).toBe(SUBSTITUTION_NOT_SAFE_TO_APPLY_MESSAGE);
    expect(out.humanReview).toBe(true);
    expect(h.repo.createPending).not.toHaveBeenCalled();
    expect(h.queues.enqueue).not.toHaveBeenCalled();
  });
});

describe('SubstitutionFlowService — dor', () => {
  it('troca só de hoje com dor: recomenda normalmente E alerta o profissional', async () => {
    const h = harness();
    h.read({ [DIAMANTE.id]: { chosen: D1.id, scope: 'TODAY' } }, { pain: true });
    const out = generate(await h.service.handle(h.input()));

    expect(out.extraSystem).toContain('SÓ PARA HOJE');
    expect(out.extraSystem).toContain('dor ou desconforto');
    expect(out.extraSystem).toContain('NÃO faça avaliação clínica');
    // Um sinal clínico não pode sumir só porque a troca era momentânea.
    expect(out.humanReview).toBe(true);
    expect(out.handoffReason).toBe('SUBSTITUTION_PAIN');
  });

  it('sem dor, não gera alerta', async () => {
    const h = harness();
    h.read({ [DIAMANTE.id]: { chosen: D1.id, scope: 'TODAY' } });
    const out = generate(await h.service.handle(h.input()));
    expect(out.humanReview).toBeFalsy();
    expect(out.handoffReason).toBeUndefined();
  });

  it('a dor dita em um turno anterior continua valendo até o fim do fluxo', async () => {
    const h = harness();
    h.read({}, { pain: true });
    await h.service.handle(h.input());
    h.read({ [DIAMANTE.id]: { chosen: D1.id, scope: 'TODAY' } }, { pain: false });
    const out = generate(await h.service.handle(h.input({ entry: 'CONTINUATION' })));
    expect(out.handoffReason).toBe('SUBSTITUTION_PAIN');
  });
});

describe('SubstitutionFlowService — troca em lote', () => {
  const BOTH: { identified: true; exerciseIds: string[] } = {
    identified: true,
    exerciseIds: [DIAMANTE.id, AFUNDO.id],
  };

  it('oferece as opções de todos os exercícios numa única mensagem, com a pergunta de alcance no plural', async () => {
    const h = harness({ identified: BOTH });
    h.read();
    const out = generate(await h.service.handle(h.input()));

    expect(out.extraSystem).toContain(`"${DIAMANTE.name}": OPÇÕES SEGURAS DA BASE`);
    expect(out.extraSystem).toContain(`"${AFUNDO.name}": OPÇÕES SEGURAS DA BASE`);
    expect(out.suffix).toBe(SUBSTITUTION_SCOPE_QUESTION_MULTI);
  });

  it('pergunta o alcance só dos exercícios que ainda não o têm', async () => {
    const h = harness({ identified: BOTH });
    h.read({ [DIAMANTE.id]: { scope: 'TODAY' } });
    const out = generate(await h.service.handle(h.input()));
    expect(out.suffix).toContain(`E pra ${AFUNDO.name}:`);
    expect(out.suffix).not.toContain(DIAMANTE.name);
  });

  it('todos no protocolo: UMA proposta com todos os itens', async () => {
    const h = harness({ identified: BOTH });
    h.read({
      [DIAMANTE.id]: { chosen: D1.id, scope: 'PROTOCOL' },
      [AFUNDO.id]: { chosen: A1.id, scope: 'PROTOCOL' },
    });
    const out = generate(await h.service.handle(h.input()));

    expect(h.repo.createPending).toHaveBeenCalledOnce();
    const created = (
      h.repo.createPending.mock.calls[0] as unknown as [
        { items: unknown[]; diff: { items: unknown[] } },
      ]
    )[0];
    expect(created.items).toHaveLength(2);
    expect(created.diff.items).toHaveLength(2);
    expect(out.extraSystem).toContain('As trocas foram CONFIRMADAS');
    expect(out.extraSystem).toContain(`"${DIAMANTE.name}" vai virar "${D1.name}"`);
    expect(out.extraSystem).toContain(`"${AFUNDO.name}" vai virar "${A1.name}"`);
    expect(h.queues.enqueue).toHaveBeenCalledOnce();
  });

  it('alcance diferente por exercício: um vai pro protocolo, o outro é só recomendação de hoje', async () => {
    const h = harness({ identified: BOTH });
    h.read({
      [DIAMANTE.id]: { chosen: D1.id, scope: 'TODAY' },
      [AFUNDO.id]: { chosen: A1.id, scope: 'PROTOCOL' },
    });
    const out = generate(await h.service.handle(h.input()));

    const created = (
      h.repo.createPending.mock.calls[0] as unknown as [
        { items: Array<{ fromExerciseId: string }> },
      ]
    )[0];
    expect(created.items.map((i) => i.fromExerciseId)).toEqual([AFUNDO.id]);
    expect(out.extraSystem).toContain('SÓ PARA HOJE');
    expect(out.extraSystem).toContain(`fazer "${D1.name}"`);
    expect(out.extraSystem).toContain(`"${AFUNDO.name}" vai virar "${A1.name}"`);
  });

  it('um item obrigatório (catálogo) segura a proposta inteira sem liberação automática', async () => {
    const h = harness({
      identified: BOTH,
      lookup: { requestedName: 'Extensora Unilateral', matchedExerciseId: null },
    });
    h.read({
      [DIAMANTE.id]: { requestedOutsideList: true, scope: 'PROTOCOL' },
      [AFUNDO.id]: { chosen: A1.id, scope: 'PROTOCOL' },
    });
    const out = fixed(await h.service.handle(h.input()));
    expect(out.text).toBe(SUBSTITUTION_CATALOG_GAP_MESSAGE);
    const created = (
      h.repo.createPending.mock.calls[0] as unknown as [{ items: Array<{ catalogGap: boolean }> }]
    )[0];
    expect(created.items.map((i) => i.catalogGap)).toEqual([true, false]);
    expect(h.queues.enqueue).not.toHaveBeenCalled();
  });

  it('um alvo do lote é excluído das opções do outro', async () => {
    const h = harness({ identified: BOTH });
    h.read();
    const out = generate(await h.service.handle(h.input()));
    const state = JSON.parse(h.store.get(h.stateKey) ?? '{}');
    const offered = state.targets.flatMap((t: { offeredIds: string[] }) => t.offeredIds);
    expect(offered).not.toContain(DIAMANTE.id);
    expect(offered).not.toContain(AFUNDO.id);
    expect(new Set(offered).size).toBe(offered.length); // sem candidato repetido entre alvos
    expect(out.kind).toBe('GENERATE');
  });

  it('lote com troca em análise: a parte do protocolo é adiada, a de hoje é recomendada', async () => {
    const h = harness({ identified: BOTH, hasPending: true });
    h.read({
      [DIAMANTE.id]: { chosen: D1.id, scope: 'TODAY' },
      [AFUNDO.id]: { chosen: A1.id, scope: 'PROTOCOL' },
    });
    const out = generate(await h.service.handle(h.input()));
    expect(out.extraSystem).toContain(`fazer "${D1.name}"`);
    expect(out.suffix).toContain(SUBSTITUTION_PROTOCOL_PART_PENDING_NOTE);
    expect(h.repo.createPending).not.toHaveBeenCalled();
  });
});

describe('SubstitutionFlowService — aluno indeciso', () => {
  it(`encerra sem pressionar depois de ${MAX_SUBSTITUTION_FOLLOW_UPS} perguntas`, async () => {
    const h = harness();
    for (let i = 0; i < MAX_SUBSTITUTION_FOLLOW_UPS; i += 1) {
      h.read();
      const out = await h.service.handle(h.input({ entry: i === 0 ? 'INTENT' : 'CONTINUATION' }));
      expect(out.kind).toBe('GENERATE');
    }
    h.read();
    const out = fixed(await h.service.handle(h.input({ entry: 'CONTINUATION' })));
    expect(out.text).toBe(SUBSTITUTION_GAVE_UP_MESSAGE);
    expect(h.store.has(h.stateKey)).toBe(false);
  });

  it('leitura do turno que falha no 1º turno não trava a oferta', async () => {
    const h = harness();
    h.resolveTurn.mockResolvedValueOnce({ ok: false });
    const out = generate(await h.service.handle(h.input()));
    expect(out.suffix).toBe(SUBSTITUTION_SCOPE_QUESTION_SINGLE);
  });
});

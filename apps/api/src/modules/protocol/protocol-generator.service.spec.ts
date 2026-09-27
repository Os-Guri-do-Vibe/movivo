import { describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../../core/config';
import type { LlmRouter } from '../ai-coach/llm/llm-router.service';
import type { LLMRequest, LLMResult } from '../ai-coach/llm/llm.types';
import type { SemanticMemoryPort } from '../ai-coach/context/semantic-memory.port';
import { EXERCISE_BY_ID, EXERCISE_CATALOG, LEVEL_ORDER, servesLocation } from './exercise-catalog';
import { ExerciseCatalogProvider } from './exercise-catalog-provider.service';
import { METHODOLOGY_GUIDELINES, METHODOLOGY_VERSION } from './methodology';
import type { MethodologyProvider } from './methodology-provider.service';
import {
  extractJsonObject,
  ProtocolGenerationError,
  ProtocolGeneratorService,
  PROMPT_VERSION,
  rtFavoritePreferenceBlock,
} from './protocol-generator.service';
import type { UserConstraints } from './user-constraints';

function llmResult(text: string): LLMResult {
  return {
    text,
    provider: 'OPENAI_GPT41',
    model: 'gpt-4.1',
    tokensInput: 100,
    tokensOutput: 200,
    tokensCached: 0,
    latencyMs: 42,
    attempt: 1,
    dataClass: 'HEALTH',
    costBrl: 0.01,
  };
}

/** JSON de protocolo válido usando um exerciseId REAL da base. */
function validProtocolJson(exerciseId = 'agachamento_barra'): string {
  return JSON.stringify({
    promptVersion: PROMPT_VERSION,
    goal: 'GAIN_MUSCLE',
    phase: 'ADAPTACAO',
    phaseDurationWeeks: 3,
    weeklyFrequency: 3,
    sessions: [
      {
        dayLabel: 'Dia A',
        focus: 'Corpo inteiro',
        exercises: [
          {
            exerciseId,
            name: 'Agachamento goblet',
            sets: 3,
            reps: { min: 8, max: 12 },
            loadStrategy: 'DOUBLE_PROGRESSION',
            restSeconds: 90,
          },
        ],
      },
    ],
  });
}

/** 3 sessões (bate com `constraints.preferredDays` = MON/WED/FRI) — `weekday` opcional. */
function threeSessionsJson(weekdays: (string | undefined)[]): string {
  return JSON.stringify({
    promptVersion: PROMPT_VERSION,
    goal: 'GAIN_MUSCLE',
    phase: 'ADAPTACAO',
    phaseDurationWeeks: 3,
    weeklyFrequency: 3,
    sessions: weekdays.map((weekday, i) => ({
      dayLabel: `Dia ${i + 1}`,
      ...(weekday ? { weekday } : {}),
      focus: 'Corpo inteiro',
      exercises: [
        {
          exerciseId: 'agachamento_barra',
          name: 'Agachamento goblet',
          sets: 3,
          reps: { min: 8, max: 12 },
          loadStrategy: 'DOUBLE_PROGRESSION',
          restSeconds: 90,
        },
      ],
    })),
  });
}

const constraints: UserConstraints = {
  goal: 'GAIN_MUSCLE',
  level: 'INICIANTE',
  trainingStatus: 'REGULAR',
  daysPerWeek: 3,
  preferredDays: ['MON', 'WED', 'FRI'],
  location: 'FULL_GYM',
  equipment: ['halteres'],
  emphasis: [],
  avoid: [],
  injuryTags: ['KNEE'],
  injuriesRaw: ['dor no joelho'],
  requiresProfessionalReview: false,
  parqTags: [],
  parqTriggered: [],
};

function makeService(
  responses: string[],
  retrieve: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue([]),
  catalog: ExerciseCatalogProvider = new ExerciseCatalogProvider(),
) {
  const calls: LLMRequest[] = [];
  const queue = [...responses];
  const llm = {
    complete: vi.fn(async (req: LLMRequest) => {
      calls.push(req);
      return llmResult(queue.shift() ?? '');
    }),
  } as unknown as LlmRouter;
  const logger = { setContext: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const methodology = {
    current: vi.fn().mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      version: 1,
      versionLabel: METHODOLOGY_VERSION,
      content: METHODOLOGY_GUIDELINES,
      contentSha256: 'a'.repeat(64),
    }),
  } as unknown as MethodologyProvider;
  const semantic = { retrieve } as unknown as SemanticMemoryPort;
  const config = { llm: { protocolMaxTokens: 6000 } } as unknown as AppConfigService;
  const service = new ProtocolGeneratorService(
    llm,
    logger as never,
    methodology,
    config,
    catalog,
    semantic,
  );
  return { service, calls, logger, retrieve };
}

function ragDoc(chunkId: string, documentId: string, snippet = chunkId) {
  return {
    chunkId,
    documentId,
    title: `Artigo ${documentId}`,
    snippet,
    score: 0.9,
  };
}

function constraintsMessage(req: LLMRequest): string {
  return req.messages.find((message) => message.content.includes('GAIN_MUSCLE'))?.content ?? '';
}

const command = { userId: 'u-1', user: { name: 'João' }, constraints };

describe('ProtocolGeneratorService', () => {
  it('gera um ProtocolStructure válido a partir da saída do LLM', async () => {
    const { service } = makeService([validProtocolJson()]);
    const result = await service.generate(command);
    expect(result.structure.goal).toBe('GAIN_MUSCLE');
    expect(result.structure.sessions[0]?.exercises[0]?.exerciseId).toBe('agachamento_barra');
    expect(result.promptVersion).toBe(PROMPT_VERSION);
    expect(result.unknownExerciseIds).toEqual([]);
  });

  it('injeta metodologia, base e constraints no prompt e fixa os params', async () => {
    const { service, calls } = makeService([validProtocolJson()]);
    await service.generate(command);
    const req = calls[0];
    if (!req) throw new Error('esperava uma chamada ao LLM');
    expect(req.purpose).toBe('PROTOCOL_GENERATION');
    expect(req.temperature).toBe(0.4);
    // Achado 2026-09-03: a metodologia mora no `system` (canal confiável), não mais
    // como mensagem `user` no envelope de dado não confiável — ver cabeçalho do arquivo.
    expect(req.system).toContain(METHODOLOGY_GUIDELINES);
    expect(req.messages.some((m) => m.content.includes('METODOLOGIA_PUBLICADA'))).toBe(false);
    // `remada_baixa_iso_lateral` (não contraindicado por KNEE) confirma que a base aparece no prompt sem
    // contradizer o filtro de contraindicação do catálogo (constraints usa injuryTags: ['KNEE']).
    expect(req.system).toContain('remada_baixa_iso_lateral');
    expect(req.system).not.toContain('agachamento_barra'); // contraindicado por KNEE — filtrado do prompt
    expect(constraintsMessage(req)).toContain('GAIN_MUSCLE');
    expect(constraintsMessage(req)).toContain('KNEE');
  });

  // Achado 2026-09-02 (correção do fundador): o evento-alvo é contexto de OTIMIZAÇÃO do
  // prompt (fase/ênfase/progressão dentro do prazo real) — nunca fonte de
  // "phaseDurationWeeks" nem instrução pra prometer o resultado que o aluno descreveu.
  it('inclui o evento-alvo (Data-alvo) no prompt como otimização, nunca como promessa', async () => {
    const { service, calls } = makeService([validProtocolJson()]);
    await service.generate({
      ...command,
      constraints: {
        ...constraints,
        importantEvent: {
          date: '2026-12-25',
          daysUntil: 114,
          description: 'quero emagrecer e chegar a 70kg pro Natal',
        },
      },
    });
    const req = calls[0];
    if (!req) throw new Error('esperava uma chamada ao LLM');
    const message = constraintsMessage(req);
    expect(message).toContain('faltam 114 dias');
    expect(message).toContain('2026-12-25');
    expect(message).toContain('quero emagrecer e chegar a 70kg pro Natal');
    expect(message).toContain('NÃO prometa nem confirme esse número');
    expect(req.system).toContain('DURAÇÃO DO MESOCICLO');
  });

  it('sem evento-alvo, não inclui o bloco de otimização no prompt', async () => {
    const { service, calls } = makeService([validProtocolJson()]);
    await service.generate(command);
    const req = calls[0];
    if (!req) throw new Error('esperava uma chamada ao LLM');
    expect(constraintsMessage(req)).not.toContain('Evento/objetivo com prazo real');
  });

  it('busca evidência por facetas, combina mais de 3 trechos e remove duplicatas', async () => {
    const shared = ragDoc('chunk-shared', 'doc-shared');
    const retrieve = vi
      .fn()
      .mockResolvedValueOnce([ragDoc('chunk-goal-1', 'doc-1'), shared])
      .mockResolvedValueOnce([ragDoc('chunk-dose-1', 'doc-2'), shared])
      .mockResolvedValueOnce([ragDoc('chunk-place-1', 'doc-3')])
      .mockResolvedValueOnce([ragDoc('chunk-limit-1', 'doc-4')]);
    const { service, calls } = makeService([validProtocolJson()], retrieve);

    const result = await service.generate(command);

    expect(retrieve).toHaveBeenCalledTimes(4);
    expect(retrieve.mock.calls.every((call) => call[1]?.topK === 10)).toBe(true);
    expect(retrieve.mock.calls[0]?.[0]).toContain('hipertrofia');
    expect(retrieve.mock.calls[0]?.[0]).toContain('definição muscular');
    expect(result.knowledgeSources).toHaveLength(5);
    expect(
      result.knowledgeSources?.filter((source) => source.chunkId === 'chunk-shared'),
    ).toHaveLength(1);
    const evidenceMessage = calls[0]?.messages.find((message) =>
      message.content.includes('EVIDENCIAS_SELETIVAS'),
    );
    expect(evidenceMessage?.content).toContain('chunk-goal-1');
    expect(evidenceMessage?.content).toContain('chunk-limit-1');
  });

  it('preserva facetas disponíveis quando uma busca do RAG falha', async () => {
    const retrieve = vi
      .fn()
      .mockRejectedValueOnce(new Error('embedding indisponível'))
      .mockResolvedValueOnce([ragDoc('chunk-dose', 'doc-dose')])
      .mockResolvedValue([]);
    const { service, logger } = makeService([validProtocolJson()], retrieve);

    const result = await service.generate(command);

    expect(result.knowledgeSources?.map((source) => source.chunkId)).toEqual(['chunk-dose']);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-1' }),
      expect.stringContaining('faceta do RAG indisponível'),
    );
  });

  it('expande emagrecimento para definição, composição corporal e hipertrofia na busca', async () => {
    const retrieve = vi.fn().mockResolvedValue([]);
    const { service } = makeService([validProtocolJson()], retrieve);

    await service.generate({
      ...command,
      constraints: { ...constraints, goal: 'LOSE_FAT', injuryTags: [] },
    });

    const goalQuery = String(retrieve.mock.calls[0]?.[0]);
    expect(goalQuery).toContain('emagrecimento');
    expect(goalQuery).toContain('definição muscular');
    expect(goalQuery).toContain('hipertrofia');
  });

  it('ensina a divisão de treino e a técnica avançada da metodologia v2', async () => {
    const { service, calls } = makeService([validProtocolJson()]);
    await service.generate(command);
    const req = calls[0];
    if (!req) throw new Error('esperava uma chamada ao LLM');
    expect(req.system).toContain('splitType'); // schema com divisão
    expect(req.system).toContain('PUSH_PULL_LEGS');
    expect(req.system).toContain('technique'); // schema com técnica avançada
    expect(req.system).toContain('grupos:'); // grupos musculares no catálogo do prompt
    // O nível do usuário limita as divisões oferecidas (INICIANTE não recebe ABC/ABCDE).
    const userMessage = constraintsMessage(req);
    expect(userMessage).toContain('Divisões permitidas para este nível: FULL_BODY');
    expect(userMessage).not.toContain('ABCDE');
  });

  // Achado 2026-08-18: sem os dias REAIS declarados, a IA gerava sessões genéricas sem
  // vínculo com a rotina do aluno (podendo entregar menos sessões do que dias declarados).
  it('exige uma sessão por dia real declarado, com o campo weekday no schema', async () => {
    const { service, calls } = makeService([validProtocolJson()]);
    await service.generate(command);
    const req = calls[0];
    if (!req) throw new Error('esperava uma chamada ao LLM');
    expect(req.system).toContain('"weekday"'); // schema com o campo novo
    const userMessage = constraintsMessage(req);
    expect(userMessage).toContain('MON, WED, FRI');
    expect(userMessage).toContain('EXATAMENTE uma sessão por dia');
  });

  it('sem preferredDays, não força a instrução de dias reais no prompt', async () => {
    const { service, calls } = makeService([validProtocolJson()]);
    await service.generate({ ...command, constraints: { ...constraints, preferredDays: [] } });
    const req = calls[0];
    if (!req) throw new Error('esperava uma chamada ao LLM');
    const userMessage = constraintsMessage(req);
    expect(userMessage).not.toContain('Dias da semana em que o aluno vai treinar');
  });

  it('tolera JSON dentro de cercas de código (```json)', async () => {
    const fenced = '```json\n' + validProtocolJson() + '\n```';
    const { service } = makeService([fenced]);
    const result = await service.generate(command);
    expect(result.structure.weeklyFrequency).toBe(3);
  });

  it('faz 1 retry corretivo quando a primeira saída é malformada', async () => {
    const { service, calls } = makeService(['isto não é json', validProtocolJson()]);
    const result = await service.generate(command);
    expect(result.structure.phase).toBe('ADAPTACAO');
    expect(calls).toHaveLength(2);
    // o retry acrescenta a instrução corretiva
    expect(calls[1]?.messages.at(-1)?.content).toContain('JSON válido');
  });

  it('lança ProtocolGenerationError se as duas tentativas forem malformadas', async () => {
    const { service } = makeService(['lixo', 'mais lixo']);
    await expect(service.generate(command)).rejects.toBeInstanceOf(ProtocolGenerationError);
  });

  it('sinaliza exercício fora da base (rede de segurança da US-2.3) sem falhar', async () => {
    const { service } = makeService([validProtocolJson('exercicio_fantasma')]);
    const result = await service.generate(command);
    expect(result.unknownExerciseIds).toContain('exercicio_fantasma');
  });

  // Achado 2026-08-18 (evidência real de testes ponta a ponta): o GPT-4.1 devolvia
  // "weekday" ausente em TODAS as sessões mesmo com instrução enfática no prompt —
  // reforço determinístico por posição em vez de continuar apostando em texto de prompt.
  describe('backfill de "weekday" ausente (achado 2026-08-18)', () => {
    it('todas as sessões sem weekday + contagem bate com preferredDays → preenche por posição', async () => {
      const { service, logger } = makeService([
        threeSessionsJson([undefined, undefined, undefined]),
      ]);
      const result = await service.generate(command);
      expect(result.structure.sessions.map((s) => s.weekday)).toEqual(['MON', 'WED', 'FRI']);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ preferredDays: ['MON', 'WED', 'FRI'] }),
        expect.stringContaining('preenchendo por posição'),
      );
    });

    it('sessão com weekday parcialmente presente → NÃO mexe (deixa o validador decidir)', async () => {
      const { service } = makeService([threeSessionsJson(['MON', undefined, 'FRI'])]);
      const result = await service.generate(command);
      expect(result.structure.sessions.map((s) => s.weekday)).toEqual(['MON', undefined, 'FRI']);
    });

    it('todas as sessões já com weekday certo → não mexe, não loga', async () => {
      const { service, logger } = makeService([threeSessionsJson(['MON', 'WED', 'FRI'])]);
      const result = await service.generate(command);
      expect(result.structure.sessions.map((s) => s.weekday)).toEqual(['MON', 'WED', 'FRI']);
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.stringContaining('preenchendo por posição'),
      );
    });

    it('contagem de sessões diferente de preferredDays → NÃO preenche (deixa SESSION_COUNT_MISMATCH pegar)', async () => {
      const { service } = makeService([validProtocolJson()]); // 1 sessão só, preferredDays tem 3
      const result = await service.generate(command);
      expect(result.structure.sessions.map((s) => s.weekday)).toEqual([undefined]);
    });

    it('preferredDays vazio → NÃO preenche', async () => {
      const { service } = makeService([threeSessionsJson([undefined, undefined, undefined])]);
      const result = await service.generate({
        ...command,
        constraints: { ...constraints, preferredDays: [] },
      });
      expect(result.structure.sessions.every((s) => s.weekday === undefined)).toBe(true);
    });
  });
});

// Achado 2026-09-26: favoritos do RT CREF no painel "Exercícios" viram PREFERÊNCIA de
// prescrição (desempate), nunca eixo de segurança — o filtro da base não muda.
describe('favoritos do RT na BASE DE REFERÊNCIA (achado 2026-09-26)', () => {
  const FAVORITE_MARKER = 'preferido pelo profissional CREF: sim';
  const FAVORITE_BLOCK_HEADER = 'PREFERÊNCIA DE PRESCRIÇÃO DO PROFISSIONAL CREF';
  const BASE_HEADER = 'BASE DE REFERÊNCIA (use SOMENTE';

  const baseConstraints: UserConstraints = {
    ...constraints,
    location: 'FULL_GYM',
    level: 'INICIANTE',
    injuryTags: [],
    injuriesRaw: [],
  };

  /** Catálogo estático com `isFavorite` explícito (true nos ids dados, false no resto). */
  function catalogWithFavorites(favoriteIds: readonly string[]): ExerciseCatalogProvider {
    for (const id of favoriteIds) {
      // Um id digitado errado faria o teste passar sem testar nada.
      if (!EXERCISE_BY_ID.has(id)) throw new Error(`id de teste fora do catálogo: ${id}`);
    }
    const favorites = new Set(favoriteIds);
    const entries = EXERCISE_CATALOG.map((e) => ({ ...e, isFavorite: favorites.has(e.id) }));
    const byId = new Map(entries.map((e) => [e.id, e]));
    return {
      getAll: () => entries,
      getById: (id: string) => byId.get(id),
      isKnown: (id: string) => byId.has(id),
    } as unknown as ExerciseCatalogProvider;
  }

  /** `system` prompt real enviado ao LLM. Sem `catalog`: bootstrap (`isFavorite` undefined). */
  async function systemPromptFor(
    c: UserConstraints,
    catalog?: ExerciseCatalogProvider,
  ): Promise<string> {
    const { service, calls } = makeService([validProtocolJson()], undefined, catalog);
    await service.generate({ ...command, constraints: c });
    const system = calls[0]?.system;
    if (!system) throw new Error('esperava uma chamada ao LLM');
    return system;
  }

  /** Linhas de exercício ("- id | ...") da seção BASE DE REFERÊNCIA, na ordem do prompt. */
  function referenceBaseLines(system: string): string[] {
    const lines = system.split('\n');
    const start = lines.findIndex((line) => line.startsWith(BASE_HEADER));
    const end = lines.indexOf('SCHEMA DO JSON DE SAÍDA:');
    if (start === -1 || end <= start) throw new Error('seção BASE DE REFERÊNCIA não encontrada');
    return lines.slice(start + 1, end).filter((line) => line.startsWith('- '));
  }

  const lineId = (line: string): string => line.slice(2).split(' | ', 1)[0] ?? '';

  /** Ordem ANTERIOR a esta mudança (filtro + sort estável só por equipamento), congelada. */
  function legacyOrderIds(c: UserConstraints): string[] {
    const filtered = EXERCISE_CATALOG.filter(
      (e) =>
        servesLocation(e, c.location) &&
        LEVEL_ORDER[e.minLevel] <= LEVEL_ORDER[c.level] &&
        !e.contraindicatedFor.some((tag) => c.injuryTags.includes(tag)),
    );
    const equipmentFirst = c.location === 'FULL_GYM' || c.location === 'CONDO_GYM';
    const ordered = equipmentFirst
      ? [...filtered].sort(
          (a, b) => Number(b.equipment.length > 0) - Number(a.equipment.length > 0),
        )
      : filtered;
    return ordered.map((e) => e.id);
  }

  it('zero favoritos na base: prompt byte a byte igual ao do catálogo sem favoritos, sem o bloco', async () => {
    const baseline = await systemPromptFor(baseConstraints); // bootstrap: isFavorite undefined
    const allFalse = await systemPromptFor(baseConstraints, catalogWithFavorites([]));

    expect(allFalse).toBe(baseline);
    expect(baseline).not.toContain(FAVORITE_BLOCK_HEADER);
    expect(baseline).not.toContain(FAVORITE_MARKER);
    // Sort estável: sem favoritos, a ordem é a MESMA de antes desta mudança — inclusive em
    // HOME, onde antes não havia sort nenhum.
    for (const c of [baseConstraints, { ...baseConstraints, location: 'HOME' as const }]) {
      expect(referenceBaseLines(await systemPromptFor(c)).map(lineId)).toEqual(legacyOrderIds(c));
    }
  });

  it('FULL_GYM: equipamento é critério primário, favorito só desempata dentro da faixa', async () => {
    const favorites = ['supino_reto_halter', 'roda_abdominal']; // com equip / sem equip
    const system = await systemPromptFor(baseConstraints, catalogWithFavorites(favorites));
    const ids = referenceBaseLines(system).map(lineId);
    const rank = (id: string): number => {
      const exercise = EXERCISE_BY_ID.get(id);
      if (!exercise) throw new Error(`id fora do catálogo no prompt: ${id}`);
      return 2 * Number(exercise.equipment.length > 0) + Number(favorites.includes(id));
    };
    const ranks = ids.map(rank);

    // [equip+fav] > [equip] > [sem equip+fav] > [sem equip] — ordem não-crescente.
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    expect(new Set(ranks)).toEqual(new Set([3, 2, 1, 0]));
    expect(ids[0]).toBe('supino_reto_halter');
    expect(ids[ranks.indexOf(1)]).toBe('roda_abdominal');
    // Bloco presente, depois da DURAÇÃO DO MESOCICLO e imediatamente antes da BASE.
    expect(system).toContain(`${rtFavoritePreferenceBlock()}\n\n${BASE_HEADER}`);
    expect(system.indexOf('DURAÇÃO DO MESOCICLO')).toBeLessThan(
      system.indexOf(FAVORITE_BLOCK_HEADER),
    );
  });

  it('caso do fundador: cadeira_flexora_maquina favoritada, aluno HOME + KNEE — some do prompt, sem bloco', async () => {
    // Só serve FULL_GYM e é contraindicada para KNEE: vetada por local (e por contraindicação).
    const c: UserConstraints = { ...baseConstraints, location: 'HOME', injuryTags: ['KNEE'] };
    const baseline = await systemPromptFor(c);
    const system = await systemPromptFor(c, catalogWithFavorites(['cadeira_flexora_maquina']));

    expect(system).not.toContain('cadeira_flexora_maquina');
    expect(system).not.toContain(FAVORITE_BLOCK_HEADER);
    expect(system).toBe(baseline);
  });

  it('HOME: favorito remada_invertida vira a PRIMEIRA linha, com o marcador no fim e o id intacto', async () => {
    const c: UserConstraints = { ...baseConstraints, location: 'HOME' };
    const baselineLine = referenceBaseLines(await systemPromptFor(c)).find(
      (line) => lineId(line) === 'remada_invertida',
    );
    const system = await systemPromptFor(c, catalogWithFavorites(['remada_invertida']));
    const first = referenceBaseLines(system)[0] ?? '';

    expect(lineId(first)).toBe('remada_invertida');
    expect(first.startsWith('- remada_invertida | ')).toBe(true);
    expect(first.endsWith(` | ${FAVORITE_MARKER}`)).toBe(true);
    // Resto da linha idêntico ao de antes: o marcador é só um sufixo.
    expect(first).toBe(`${baselineLine} | ${FAVORITE_MARKER}`);
    expect(system).toContain(FAVORITE_BLOCK_HEADER);
  });

  it('favorito eliminado SÓ por contraindicação (supino_reto_halter, FULL_GYM + SHOULDER) não aparece', async () => {
    const catalog = catalogWithFavorites(['supino_reto_halter']);
    // Controle: mesmo local e nível, sem a tag — aparece. Prova que local/nível não o excluem.
    const control = await systemPromptFor(baseConstraints, catalog);
    expect(referenceBaseLines(control).map(lineId)).toContain('supino_reto_halter');

    const c: UserConstraints = { ...baseConstraints, injuryTags: ['SHOULDER'] };
    const system = await systemPromptFor(c, catalog);

    expect(system).not.toContain('supino_reto_halter');
    expect(system).not.toContain(FAVORITE_BLOCK_HEADER);
    expect(system).toBe(await systemPromptFor(c));
  });

  it('o marcador aparece só nas linhas favoritadas que sobreviveram ao filtro', async () => {
    // FULL_GYM + KNEE: supino_reto_halter e roda_abdominal sobrevivem; cadeira_flexora_maquina
    // sai por KNEE; remada_invertida sai por local (não serve FULL_GYM).
    const c: UserConstraints = { ...baseConstraints, injuryTags: ['KNEE'] };
    const system = await systemPromptFor(
      c,
      catalogWithFavorites([
        'supino_reto_halter',
        'roda_abdominal',
        'cadeira_flexora_maquina',
        'remada_invertida',
      ]),
    );
    const marked = referenceBaseLines(system)
      .filter((line) => line.includes(FAVORITE_MARKER))
      .map(lineId);
    const section = system.slice(
      system.indexOf(BASE_HEADER),
      system.indexOf('SCHEMA DO JSON DE SAÍDA:'),
    );

    expect(marked.sort()).toEqual(['roda_abdominal', 'supino_reto_halter']);
    expect(section.split(FAVORITE_MARKER).length - 1).toBe(2);
  });

  it('guardrail de linguagem: o bloco não usa termos vetados e mantém a IA como ferramenta do CREF', () => {
    const block = rtFavoritePreferenceBlock();

    expect(block).not.toMatch(/diagnóstic/i);
    expect(block).not.toMatch(/tratamento/i);
    expect(block).not.toMatch(/\bcura\b/i);
    expect(block).not.toMatch(/garantid/i);
    expect(block).toContain('Você atua como ferramenta desse profissional');
  });
});

describe('extractJsonObject', () => {
  it('extrai o objeto entre a primeira { e a última }', () => {
    expect(extractJsonObject('prefixo {"a":1} sufixo')).toBe('{"a":1}');
  });

  it('retorna null quando não há objeto', () => {
    expect(extractJsonObject('sem json aqui')).toBeNull();
  });
});

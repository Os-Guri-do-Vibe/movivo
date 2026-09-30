/**
 * Unit — mensagem de correção da rodada de feedback (redução de fallback, 2026-09-29).
 *
 * Traz código + localização exata; opções de troca só da base filtrada deste aluno (nunca
 * um id vetado); violação de linguagem cita só o caminho, sem ecoar o texto livre.
 */
import type { ProtocolStructure } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import { EXERCISE_CATALOG } from '../exercise-catalog';
import { ExerciseCatalogProvider } from '../exercise-catalog-provider.service';
import type { UserConstraints } from '../user-constraints';
import {
  buildCorrectionMessage,
  CORRECTION_FOOTER,
  CORRECTION_HEADER,
  MAX_REPLACEMENT_OPTIONS,
  NO_PATTERN_OPTION_REMOVE,
  NO_PATTERN_OPTION_SWAP,
} from './violation-feedback';
import { ValidationService } from './validation.service';

const catalog = new ExerciseCatalogProvider();
const validation = new ValidationService(catalog);

const constraints: Pick<UserConstraints, 'level' | 'preferredDays' | 'injuryTags' | 'parqTags'> = {
  level: 'INICIANTE',
  preferredDays: ['MON', 'WED'],
  injuryTags: ['KNEE'],
  parqTags: [],
};

/** Base "filtrada" do teste: todo exercício INICIANTE não contraindicado por KNEE. */
const referenceBaseIds = EXERCISE_CATALOG.filter(
  (e) => e.levels.includes('INICIANTE') && !e.contraindicatedFor.includes('KNEE'),
).map((e) => e.id);

type Exercise = ProtocolStructure['sessions'][number]['exercises'][number];
const ex = (exerciseId: string, over: Partial<Exercise> = {}): Exercise => ({
  exerciseId,
  name: catalog.getById(exerciseId)?.name ?? exerciseId,
  sets: 3,
  reps: { min: 8, max: 12 },
  loadStrategy: 'DOUBLE_PROGRESSION',
  restSeconds: 60,
  ...over,
});

function structure(first: Exercise[], second: Exercise[]): ProtocolStructure {
  return {
    promptVersion: 'v1',
    goal: 'GAIN_MUSCLE',
    phase: 'ADAPTACAO',
    phaseDurationWeeks: 3,
    splitType: 'FULL_BODY',
    weeklyFrequency: 2,
    sessions: [
      { dayLabel: 'Treino A', weekday: 'MON', focus: 'Corpo inteiro', exercises: first },
      { dayLabel: 'Treino B', weekday: 'WED', focus: 'Corpo inteiro', exercises: second },
    ],
  };
}

function messageFor(s: ProtocolStructure): string {
  const verdict = validation.validate({
    structure: s,
    constraints: {
      goal: 'GAIN_MUSCLE',
      injuryTags: constraints.injuryTags,
      level: constraints.level,
      preferredDays: constraints.preferredDays,
    },
    parqFlags: constraints.parqTags,
  });
  expect(verdict.action).toBe('BLOCK_FALLBACK');
  return buildCorrectionMessage(s, verdict.violations, constraints, referenceBaseIds, catalog);
}

/** Ids listados em "Opções válidas: a, b, c." de uma linha. */
const optionsIn = (line: string): string[] =>
  (line.match(/Opções válidas: ([^.]+)\./)?.[1] ?? '').split(', ').filter(Boolean);

describe('buildCorrectionMessage', () => {
  it('cabeçalho e rodapé literais, itens numerados com o código da regra', () => {
    const msg = messageFor(
      structure([ex('supino_reto_halter', { technique: 'SUPERSET' })], [ex('supino_reto_halter')]),
    );
    const lines = msg.split('\n');
    expect(lines[0]).toBe(CORRECTION_HEADER);
    expect(lines.at(-1)).toBe(CORRECTION_FOOTER);
    expect(lines[1]).toMatch(/^1\. \[TECHNIQUE_LEVEL_NOT_ALLOWED\]/);
    // Localização exata: sessão por índice + weekday, exercício por índice + id.
    expect(lines[1]).toContain(
      'sessions[0] (MON).exercises[0] "supino_reto_halter" (technique=SUPERSET)',
    );
  });

  it('exercício contraindicado: localização + opções do mesmo padrão, só da base, nunca o vetado', () => {
    const vetoed = 'levantamento_terra_romeno_halter'; // HINGE, contraindicado por KNEE
    const msg = messageFor(structure([ex('supino_reto_halter')], [ex(vetoed)]));
    const line = msg.split('\n').find((l) => l.includes('[EXERCISE_CONTRAINDICATED]')) ?? '';
    expect(line).toContain(`"${vetoed}" em sessions[1] (WED).exercises[0]`);
    const options = optionsIn(line);
    expect(options.length).toBeGreaterThan(0);
    expect(options.length).toBeLessThanOrEqual(MAX_REPLACEMENT_OPTIONS);
    expect(options).not.toContain(vetoed);
    for (const id of options) {
      expect(referenceBaseIds).toContain(id);
      expect(catalog.getById(id)?.pattern).toBe('HINGE');
      expect(catalog.getById(id)?.contraindicatedFor).not.toContain('KNEE');
    }
  });

  it('exercício acima do nível: opções da base filtrada, nunca o id vetado', () => {
    const vetoed = 'barra_fixa_com_peso'; // VERTICAL_PULL, acima de INICIANTE
    expect(catalog.getById(vetoed)?.levels).not.toContain('INICIANTE');
    const msg = messageFor(structure([ex(vetoed)], [ex('supino_reto_halter')]));
    const line = msg.split('\n').find((l) => l.includes('[EXERCISE_LEVEL_TOO_HIGH]')) ?? '';
    expect(line).toContain(`"${vetoed}" em sessions[0] (MON).exercises[0]`);
    const options = optionsIn(line);
    expect(options.length).toBeGreaterThan(0);
    expect(options).not.toContain(vetoed);
    for (const id of options) {
      expect(referenceBaseIds).toContain(id);
      expect(catalog.getById(id)?.pattern).toBe('VERTICAL_PULL');
    }
  });

  it('id inexistente: opções pela primeira palavra do id, só da base', () => {
    const msg = messageFor(structure([ex('supino_reto_maquina')], [ex('supino_reto_halter')]));
    const line = msg.split('\n').find((l) => l.includes('[EXERCISE_UNKNOWN]')) ?? '';
    expect(line).toContain('"supino_reto_maquina" em sessions[0] (MON).exercises[0]');
    const options = optionsIn(line);
    expect(options.length).toBeGreaterThan(0);
    for (const id of options) {
      expect(id.startsWith('supino_')).toBe(true);
      expect(referenceBaseIds).toContain(id);
    }
  });

  // Revisão do Victor (2026-09-29): padrão sem NENHUMA opção na base deste aluno.
  describe('padrão sem opção na base do aluno', () => {
    const vetoed = 'levantamento_terra_romeno_halter'; // HINGE, contraindicado por KNEE
    const baseWithoutHinge = referenceBaseIds.filter(
      (id) => catalog.getById(id)?.pattern !== 'HINGE',
    );
    const lineFor = (s: ProtocolStructure): string => {
      const verdict = validation.validate({
        structure: s,
        constraints: {
          goal: 'GAIN_MUSCLE',
          injuryTags: constraints.injuryTags,
          level: constraints.level,
          preferredDays: constraints.preferredDays,
        },
      });
      return (
        buildCorrectionMessage(s, verdict.violations, constraints, baseWithoutHinge, catalog)
          .split('\n')
          .find((l) => l.includes('[EXERCISE_CONTRAINDICATED]')) ?? ''
      );
    };

    it('remover é seguro → manda remover sem substituir e manter o restante', () => {
      const line = lineFor(
        structure([ex('supino_reto_halter'), ex(vetoed)], [ex('supino_reto_halter')]),
      );
      expect(line).toContain(NO_PATTERN_OPTION_REMOVE);
      expect(line).not.toContain('Opções válidas');
      expect(line).not.toContain('do mesmo padrão de movimento —');
    });

    it('remover deixaria a sessão vazia → troca pelo grupo muscular mais próximo, só da base', () => {
      const line = lineFor(structure([ex(vetoed)], [ex('supino_reto_halter')]));
      expect(line).not.toContain(NO_PATTERN_OPTION_REMOVE);
      expect(line).toContain(NO_PATTERN_OPTION_SWAP);
      const options = optionsIn(line);
      expect(options.length).toBeGreaterThan(0);
      for (const id of options) {
        expect(baseWithoutHinge).toContain(id);
        expect(catalog.getById(id)?.pattern).not.toBe('ISOLATION');
      }
    });

    it('remover deixaria isolados acima do teto → troca, não remove', () => {
      const line = lineFor(
        structure(
          [ex('rosca_direta_barra'), ex('triceps_na_polia_com_corda'), ex(vetoed)],
          [ex('supino_reto_halter')],
        ),
      );
      expect(line).toContain(NO_PATTERN_OPTION_SWAP);
    });
  });

  it('linguagem proibida: só o caminho do campo, nunca o texto livre', () => {
    const secret = 'histórico de hérnia de disco lombar';
    const s = structure(
      [ex('supino_reto_halter', { notes: `Cuidado com o ${secret}.` })],
      [ex('supino_reto_halter')],
    );
    const second = s.sessions[1];
    if (!second) throw new Error('fixture inválida');
    second.dayLabel = 'Treino de tendinite';
    const msg = messageFor(s);
    expect(msg).toContain('[DIAGNOSIS]');
    expect(msg).toContain('sessions[0].exercises[0].notes');
    expect(msg).toContain('sessions[1].dayLabel');
    expect(msg).not.toContain(secret);
    expect(msg).not.toContain('hérnia');
    expect(msg).not.toContain('tendinite');
    // Nem o `dayLabel` de nenhuma sessão é ecoado como referência.
    expect(msg).not.toContain('Treino A');
  });

  it('PAR-Q: piso de RIR do validador (3 com CARDIAC) e ocorrências localizadas', () => {
    const s = structure([ex('supino_reto_halter', { rir: 1 })], [ex('supino_reto_halter')]);
    const verdict = validation.validate({
      structure: s,
      constraints: { goal: 'GAIN_MUSCLE', injuryTags: ['CARDIAC'], maxPhase: 'ADAPTACAO' },
      parqFlags: ['CARDIAC'],
    });
    const msg = buildCorrectionMessage(
      s,
      verdict.violations,
      { ...constraints, parqTags: ['CARDIAC'] },
      referenceBaseIds,
      catalog,
    );
    expect(msg).toContain('[PARQ_RIR_TOO_LOW] Piso: rir >= 3');
    expect(msg).toContain('sessions[0] (MON).exercises[0] "supino_reto_halter" (rir=1)');
  });

  it('ignora violações FLAG e regra desconhecida não ecoa o detail', () => {
    const s = structure([ex('supino_reto_halter')], [ex('supino_reto_halter')]);
    const msg = buildCorrectionMessage(
      s,
      [
        { rule: 'REGRA_NOVA', detail: 'texto livre sensível', action: 'BLOCK' },
        { rule: 'SO_FLAG', detail: 'x', action: 'FLAG' },
      ],
      constraints,
      referenceBaseIds,
      catalog,
    );
    expect(msg).toContain('[REGRA_NOVA]');
    expect(msg).not.toContain('texto livre sensível');
    expect(msg).not.toContain('SO_FLAG');
  });
});

/** Chamada direta com as violações dadas (sem passar pelo validador). */
function direct(
  s: ProtocolStructure,
  rules: string[],
  over: Partial<typeof constraints> = {},
  base: readonly string[] = referenceBaseIds,
): string {
  return buildCorrectionMessage(
    s,
    rules.map((rule) => ({ rule, detail: 'x', action: 'BLOCK' as const })),
    { ...constraints, ...over },
    base,
    catalog,
  );
}

/** Violações reais do validador para `s` (nível/dias configuráveis). */
function realMessage(
  s: ProtocolStructure,
  input: {
    level?: 'INICIANTE' | 'INTERMEDIARIO' | 'AVANCADO';
    preferredDays?: ('MON' | 'WED' | 'FRI')[];
    maxPhase?: 'ADAPTACAO';
    parqTags?: ('BALANCE_FALL_RISK' | 'CARDIAC')[];
    injuryTags?: 'KNEE'[];
  } = {},
): string {
  const level = input.level ?? 'INICIANTE';
  const preferredDays = input.preferredDays ?? ['MON', 'WED'];
  const parqTags = input.parqTags ?? [];
  const injuryTags = input.injuryTags ?? [];
  const verdict = validation.validate({
    structure: s,
    constraints: {
      goal: 'GAIN_MUSCLE',
      injuryTags,
      level,
      preferredDays,
      ...(input.maxPhase ? { maxPhase: input.maxPhase } : {}),
    },
    parqFlags: parqTags,
  });
  expect(verdict.action).toBe('BLOCK_FALLBACK');
  return buildCorrectionMessage(
    s,
    verdict.violations,
    { level, preferredDays, injuryTags, parqTags },
    referenceBaseIds,
    catalog,
  );
}

const lineOf = (msg: string, rule: string): string =>
  msg.split('\n').find((l) => l.includes(`[${rule}]`)) ?? '';

describe('buildCorrectionMessage — cada regra traz localização e o que cumprir', () => {
  it('exercício inexistente + contraindicado na mesma saída: cada item só cita o seu id', () => {
    const vetoed = 'levantamento_terra_romeno_halter';
    const msg = direct(
      structure([ex('exercicio_fantasma'), ex(vetoed)], [ex('supino_reto_halter')]),
      ['EXERCISE_UNKNOWN', 'EXERCISE_CONTRAINDICATED'],
    );
    expect(lineOf(msg, 'EXERCISE_UNKNOWN')).toContain('"exercicio_fantasma"');
    expect(lineOf(msg, 'EXERCISE_UNKNOWN')).not.toContain(vetoed);
    expect(lineOf(msg, 'EXERCISE_CONTRAINDICATED')).toContain(`"${vetoed}"`);
    expect(lineOf(msg, 'EXERCISE_CONTRAINDICATED')).not.toContain('exercicio_fantasma');
  });

  it('id inexistente, sem opção pelo nome e sozinho na sessão: troca por não-isolado da base', () => {
    const msg = direct(structure([ex('zzz_inventado')], [ex('supino_reto_halter')]), [
      'EXERCISE_UNKNOWN',
    ]);
    const line = lineOf(msg, 'EXERCISE_UNKNOWN');
    expect(line).toContain(NO_PATTERN_OPTION_SWAP);
    const options = optionsIn(line);
    expect(options).toHaveLength(MAX_REPLACEMENT_OPTIONS);
    for (const id of options) {
      expect(referenceBaseIds).toContain(id);
      expect(catalog.getById(id)?.pattern).not.toBe('ISOLATION');
    }
  });

  it('troca pelo grupo muscular mais próximo quando a base tem não-isolado com grupo em comum', () => {
    const bad = catalog.getById('remada_curvada_halter');
    if (!bad) throw new Error('fixture');
    const sameGroup = EXERCISE_CATALOG.find(
      (e) =>
        e.pattern !== bad.pattern &&
        e.pattern !== 'ISOLATION' &&
        e.muscleGroups.some((g) => bad.muscleGroups.includes(g)),
    );
    if (!sameGroup) throw new Error('fixture sem grupo em comum');
    const base = ['agachamento_goblet', sameGroup.id];
    const msg = direct(
      structure([ex(bad.id)], [ex('supino_reto_halter')]),
      ['EXERCISE_CONTRAINDICATED'],
      { injuryTags: ['SHOULDER'] },
      base,
    );
    expect(optionsIn(lineOf(msg, 'EXERCISE_CONTRAINDICATED'))).toEqual([sameGroup.id]);
  });

  it('base só com isolados: pede a troca sem listar opção (nunca sugere isolado)', () => {
    const line = lineOf(
      direct(
        structure([ex('levantamento_terra_romeno_halter')], [ex('supino_reto_halter')]),
        ['EXERCISE_CONTRAINDICATED'],
        {},
        ['rosca_direta_barra', 'crucifixo_reto_halter'],
      ),
      'EXERCISE_CONTRAINDICATED',
    );
    expect(line).toContain(NO_PATTERN_OPTION_SWAP);
    expect(line).not.toContain('Opções válidas');
  });

  it('violação de exercício que não se localiza na estrutura: só a dica da regra', () => {
    const msg = direct(structure([ex('supino_reto_halter')], [ex('supino_reto_halter')]), [
      'EXERCISE_UNKNOWN',
    ]);
    expect(lineOf(msg, 'EXERCISE_UNKNOWN')).toMatch(/^1\. \[EXERCISE_UNKNOWN\] Troque por/);
  });

  it('TECHNIQUE_LEVEL_NOT_ALLOWED sem técnica localizável → "nenhuma localizada"', () => {
    const msg = direct(structure([ex('supino_reto_halter')], [ex('supino_reto_halter')]), [
      'TECHNIQUE_LEVEL_NOT_ALLOWED',
    ]);
    expect(msg).toContain('Ocorrências: nenhuma localizada.');
  });

  it('TECHNIQUE_OVERUSE: contagem de técnicas por sessão', () => {
    const withTechnique = (id: string) => ex(id, { technique: 'DROP_SET' });
    const msg = realMessage(
      structure(
        [
          withTechnique('supino_reto_halter'),
          withTechnique('remada_curvada_halter'),
          withTechnique('prancha'),
        ],
        [ex('supino_reto_halter')],
      ),
      { level: 'AVANCADO' },
    );
    expect(lineOf(msg, 'TECHNIQUE_OVERUSE')).toContain(
      'Exercícios com "technique" por sessão: sessions[0] (MON): 3; sessions[1] (WED): 0.',
    );
  });

  it('ISOLATION_AS_BASE: aponta a sessão e a proporção de isolados', () => {
    const msg = realMessage(
      structure(
        [ex('rosca_direta_barra'), ex('crucifixo_reto_halter')],
        [ex('supino_reto_halter')],
      ),
    );
    expect(lineOf(msg, 'ISOLATION_AS_BASE')).toContain('sessions[0] (MON) (2 de 2 são ISOLATION)');
    expect(lineOf(msg, 'ISOLATION_AS_BASE')).toContain('no máximo 70%');
  });

  it('ISOLATION_AS_BASE sem sessão localizável → texto genérico', () => {
    const msg = direct(structure([ex('supino_reto_halter')], [ex('supino_reto_halter')]), [
      'ISOLATION_AS_BASE',
    ]);
    expect(msg).toContain('sessão com isolados em excesso');
  });

  it('PARQ_PHASE_CAP_EXCEEDED: fase atual e faixa de ADAPTACAO', () => {
    const s = structure([ex('supino_reto_halter')], [ex('supino_reto_halter')]);
    s.phase = 'HIPERTROFIA';
    s.phaseDurationWeeks = 4;
    const msg = realMessage(s, { maxPhase: 'ADAPTACAO', parqTags: ['BALANCE_FALL_RISK'] });
    expect(lineOf(msg, 'PARQ_PHASE_CAP_EXCEEDED')).toContain('"phase" atual: HIPERTROFIA.');
    expect(lineOf(msg, 'PARQ_PHASE_CAP_EXCEEDED')).toContain('"phase" DEVE ser "ADAPTACAO"');
  });

  it('PARQ_VIOLATION: fase FORCA e técnica localizadas', () => {
    const s = structure(
      [ex('supino_reto_halter', { technique: 'ISOMETRIA' })],
      [ex('supino_reto_halter')],
    );
    s.phase = 'FORCA';
    s.phaseDurationWeeks = 4;
    const msg = realMessage(s, { level: 'INTERMEDIARIO', parqTags: ['BALANCE_FALL_RISK'] });
    expect(lineOf(msg, 'PARQ_VIOLATION')).toContain(
      '"phase" é FORCA; "technique" em sessions[0] (MON).exercises[0] "supino_reto_halter"',
    );
  });

  it('PARQ_VIOLATION sem nada localizável → "modo conservador violado"', () => {
    const msg = direct(structure([ex('supino_reto_halter')], [ex('supino_reto_halter')]), [
      'PARQ_VIOLATION',
    ]);
    expect(msg).toContain('modo conservador violado');
  });

  it('SESSION_COUNT_MISMATCH/WEEKDAY_MISMATCH: dias declarados × gerados (sem weekday explícito)', () => {
    const s = structure([ex('supino_reto_halter')], [ex('supino_reto_halter')]);
    const second = s.sessions[1];
    if (!second) throw new Error('fixture');
    delete second.weekday;
    const msg = realMessage(s, { preferredDays: ['MON', 'WED', 'FRI'] });
    expect(lineOf(msg, 'SESSION_COUNT_MISMATCH')).toContain(
      'Dias declarados, nesta ordem: MON, WED, FRI (3 sessões). Gerado: 2 sessões (MON, sem weekday).',
    );
    expect(lineOf(msg, 'WEEKDAY_MISMATCH')).toContain('Gerado: 2 sessões');
    // Sessão sem weekday é citada só pelo índice nas demais mensagens.
    expect(msg).not.toContain('sessions[1] (');
  });

  it('SPLIT_LEVEL_NOT_ALLOWED: divisão atual e as permitidas para o nível', () => {
    const s = structure([ex('supino_reto_halter')], [ex('supino_reto_halter')]);
    s.splitType = 'ABCDE';
    const msg = realMessage(s);
    expect(lineOf(msg, 'SPLIT_LEVEL_NOT_ALLOWED')).toContain(
      'Divisão atual: ABCDE; permitidas para INICIANTE: FULL_BODY, CIRCUITO, UPPER_LOWER.',
    );
  });

  it('SPLIT_FREQUENCY_MISMATCH: divisões que cabem nas sessões reais', () => {
    const s = structure([ex('supino_reto_halter')], [ex('supino_reto_halter')]);
    s.splitType = 'ABC';
    const msg = realMessage(s, { level: 'INTERMEDIARIO' });
    expect(lineOf(msg, 'SPLIT_FREQUENCY_MISMATCH')).toContain(
      'Divisão atual: ABC com 2 sessão(ões); cabem: FULL_BODY, CIRCUITO, UPPER_LOWER.',
    );
  });

  it('regras de divisão sem splitType na estrutura → "não informada"', () => {
    const s = structure([ex('supino_reto_halter')], [ex('supino_reto_halter')]);
    delete s.splitType;
    const msg = direct(s, ['SPLIT_LEVEL_NOT_ALLOWED', 'SPLIT_FREQUENCY_MISMATCH']);
    expect(lineOf(msg, 'SPLIT_LEVEL_NOT_ALLOWED')).toContain('Divisão atual: não informada;');
    expect(lineOf(msg, 'SPLIT_FREQUENCY_MISMATCH')).toContain('Divisão atual: não informada com');
  });

  it('PHASE_DURATION_OUT_OF_RANGE: duração atual e faixa da fase', () => {
    const s = structure([ex('supino_reto_halter')], [ex('supino_reto_halter')]);
    s.phaseDurationWeeks = 8;
    const msg = realMessage(s);
    expect(lineOf(msg, 'PHASE_DURATION_OUT_OF_RANGE')).toContain(
      '"phase" ADAPTACAO com "phaseDurationWeeks" 8; faixa: 2-4.',
    );
  });

  it('regra de linguagem sem campo localizável → sem caminho, só a instrução', () => {
    const msg = direct(structure([ex('supino_reto_halter')], [ex('supino_reto_halter')]), [
      'PROMISE',
    ]);
    expect(lineOf(msg, 'PROMISE')).toContain('Texto livre com expressão proibida. Reescreva');
  });
});

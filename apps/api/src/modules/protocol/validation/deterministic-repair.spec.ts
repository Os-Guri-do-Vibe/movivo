/**
 * Unit — reparo determinístico do planner (redução de fallback, 2026-09-29).
 *
 * Cada código reparável sai PASS no validador REAL sem alterar ids/séries/reps; cada regra
 * de segurança (ou fora da lista) devolve `null`; a variante FORCA do PAR-Q e sessões ≠
 * dias devolvem `null`; reaplicar é idempotente.
 */
import type { ProtocolStructure, Weekday } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import type { ContraindicationTag } from '../exercise-catalog';
import { ExerciseCatalogProvider } from '../exercise-catalog-provider.service';
import { PHASE_DURATION_WEEKS_RANGE } from '../protocol-timeline';
import { deterministicRepair, REPAIRABLE_RULES } from './deterministic-repair';
import { MAX_TECHNIQUES_PER_SESSION } from './validation-rules';
import {
  type ValidateProtocolInput,
  ValidationService,
  type ValidationVerdict,
} from './validation.service';

const catalog = new ExerciseCatalogProvider();
const validation = new ValidationService(catalog);
const DAYS: Weekday[] = ['MON', 'WED', 'FRI'];

type Exercise = ProtocolStructure['sessions'][number]['exercises'][number];

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('fixture: valor ausente');
  return value;
}
const sessionAt = (s: ProtocolStructure, i: number) => must(s.sessions[i]);
const exAt = (s: ProtocolStructure, i: number, j: number) => must(sessionAt(s, i).exercises[j]);

function ex(exerciseId: string, name: string, over: Partial<Exercise> = {}): Exercise {
  return {
    exerciseId,
    name,
    sets: 3,
    reps: { min: 8, max: 12 },
    loadStrategy: 'DOUBLE_PROGRESSION',
    restSeconds: 60,
    ...over,
  };
}

function base(
  exercises: () => Exercise[],
  over: Partial<ProtocolStructure> = {},
): ProtocolStructure {
  return {
    promptVersion: 'v1',
    goal: 'GAIN_MUSCLE',
    phase: 'ADAPTACAO',
    phaseDurationWeeks: 3,
    splitType: 'FULL_BODY',
    weeklyFrequency: 3,
    sessions: DAYS.map((weekday, i) => ({
      dayLabel: `Treino ${i + 1}`,
      weekday,
      focus: 'Corpo inteiro',
      exercises: exercises(),
    })),
    ...over,
  };
}

const standard = (): Exercise[] => [
  ex('agachamento_goblet', 'Agachamento Goblet'),
  ex('supino_reto_halter', 'Supino Reto (Halter)'),
  ex('remada_curvada_halter', 'Remada Curvada (Halter)'),
];

interface Scenario {
  level?: 'INICIANTE' | 'INTERMEDIARIO' | 'AVANCADO';
  parqFlags?: ContraindicationTag[];
  maxPhase?: 'ADAPTACAO';
}

function inputFor(structure: ProtocolStructure, s: Scenario = {}): ValidateProtocolInput {
  return {
    structure,
    constraints: {
      goal: 'GAIN_MUSCLE',
      injuryTags: s.parqFlags ?? [],
      level: s.level ?? 'INICIANTE',
      preferredDays: DAYS,
      ...(s.maxPhase ? { maxPhase: s.maxPhase } : {}),
    },
    parqFlags: s.parqFlags ?? [],
  };
}

function repairAndRevalidate(structure: ProtocolStructure, s: Scenario = {}) {
  const verdict = validation.validate(inputFor(structure, s));
  expect(verdict.action).toBe('BLOCK_FALLBACK');
  const repaired = deterministicRepair(structure, verdict.violations, {
    preferredDays: DAYS,
    parqFlags: s.parqFlags ?? [],
    catalog,
  });
  return {
    verdict,
    repaired,
    revalidated: repaired && validation.validate(inputFor(repaired.structure, s)),
  };
}

/** Ids, séries e repetições/duração — o que o reparo NUNCA pode mudar. */
const skeleton = (s: ProtocolStructure) =>
  s.sessions.map((session) =>
    session.exercises.map((e) => [e.exerciseId, e.sets, e.reps, e.durationSeconds]),
  );

describe('deterministicRepair — códigos reparáveis saem PASS sem mexer em id/séries/reps', () => {
  it('TECHNIQUE_LEVEL_NOT_ALLOWED → remove todo "technique"', () => {
    const structure = base(() => [
      ex('agachamento_goblet', 'Agachamento Goblet', { technique: 'SUPERSET' }),
      ex('supino_reto_halter', 'Supino Reto (Halter)', { technique: 'DESCANSO_ATIVO' }),
    ]);
    sessionAt(structure, 1).exercises.forEach((e) => delete e.technique);
    const { verdict, repaired, revalidated } = repairAndRevalidate(structure);
    expect(verdict.violations.map((v) => v.rule)).toContain('TECHNIQUE_LEVEL_NOT_ALLOWED');
    expect(repaired?.repairs).toContain('STRIP_ALL_TECHNIQUES');
    expect(revalidated?.action).toBe('PASS');
    expect(skeleton(must(repaired).structure)).toEqual(skeleton(structure));
  });

  it('PARQ_VIOLATION (técnica com PAR-Q) → remove "technique"', () => {
    const structure = base(standard);
    exAt(structure, 0, 0).technique = 'ISOMETRIA';
    const s: Scenario = { level: 'INTERMEDIARIO', parqFlags: ['BALANCE_FALL_RISK'] };
    const { verdict, repaired, revalidated } = repairAndRevalidate(structure, s);
    expect(verdict.violations.map((v) => v.rule)).toEqual(['PARQ_VIOLATION']);
    expect(revalidated?.action).toBe('PASS');
    expect(skeleton(must(repaired).structure)).toEqual(skeleton(structure));
  });

  it('TECHNIQUE_OVERUSE → mantém as primeiras N por sessão e limpa a sessão com menos técnicas', () => {
    const structure = base(() => standard().map((e) => ({ ...e, technique: 'DROP_SET' as const })));
    // sessão 2 com só 1 técnica → é a que fica limpa.
    sessionAt(structure, 1)
      .exercises.slice(1)
      .forEach((e) => delete e.technique);
    const s: Scenario = { level: 'AVANCADO' };
    const { verdict, repaired, revalidated } = repairAndRevalidate(structure, s);
    expect(new Set(verdict.violations.map((v) => v.rule))).toEqual(new Set(['TECHNIQUE_OVERUSE']));
    expect(revalidated?.action).toBe('PASS');
    const counts = must(repaired).structure.sessions.map(
      (x) => x.exercises.filter((e) => e.technique).length,
    );
    expect(counts).toEqual([MAX_TECHNIQUES_PER_SESSION, 0, MAX_TECHNIQUES_PER_SESSION]);
    // As mantidas são as PRIMEIRAS da sessão.
    expect(sessionAt(must(repaired).structure, 0).exercises.map((e) => e.technique)).toEqual([
      'DROP_SET',
      'DROP_SET',
      undefined,
    ]);
    expect(skeleton(must(repaired).structure)).toEqual(skeleton(structure));
  });

  it('PARQ_RIR_TOO_LOW → sobe ao piso (3 com CARDIAC)', () => {
    const structure = base(() => [
      ex('agachamento_goblet', 'Agachamento Goblet', { rir: 1 }),
      ex('supino_reto_halter', 'Supino Reto (Halter)', { rir: 4 }),
    ]);
    const s: Scenario = { parqFlags: ['CARDIAC'], maxPhase: 'ADAPTACAO' };
    const { repaired, revalidated } = repairAndRevalidate(structure, s);
    expect(revalidated?.action).toBe('PASS');
    expect(sessionAt(must(repaired).structure, 0).exercises.map((e) => e.rir)).toEqual([3, 4]);
    expect(skeleton(must(repaired).structure)).toEqual(skeleton(structure));
  });

  it('PARQ_RIR_TOO_LOW sem CARDIAC → piso 2', () => {
    const structure = base(() => [ex('agachamento_goblet', 'Agachamento Goblet', { rir: 0 })]);
    const s: Scenario = { parqFlags: ['BALANCE_FALL_RISK'], maxPhase: 'ADAPTACAO' };
    const { repaired, revalidated } = repairAndRevalidate(structure, s);
    expect(revalidated?.action).toBe('PASS');
    expect(exAt(must(repaired).structure, 0, 0).rir).toBe(2);
  });

  it('PHASE_DURATION_OUT_OF_RANGE → clamp na faixa da fase', () => {
    const structure = base(standard, { phase: 'HIPERTROFIA', phaseDurationWeeks: 8 });
    const { repaired, revalidated } = repairAndRevalidate(structure);
    expect(revalidated?.action).toBe('PASS');
    expect(must(repaired).structure.phaseDurationWeeks).toBe(
      PHASE_DURATION_WEEKS_RANGE.HIPERTROFIA.maxWeeks,
    );
    expect(must(repaired).structure.phase).toBe('HIPERTROFIA');
  });

  it('WEEKDAY_MISMATCH com nº de sessões == nº de dias → redistribui por posição', () => {
    const structure = base(standard);
    sessionAt(structure, 2).weekday = 'SAT';
    const { repaired, revalidated } = repairAndRevalidate(structure);
    expect(revalidated?.action).toBe('PASS');
    expect(must(repaired).structure.sessions.map((s) => s.weekday)).toEqual(DAYS);
  });

  it.each([
    ['DIAGNOSIS', 'Mantenha a postura neutra. Cuidado com o histórico de hérnia de disco.'],
    ['MED_PRESCRIPTION', 'Execute devagar. Se doer, tome um analgésico.'],
    ['PROMISE', 'Controle a descida! Resultado garantido em 30 dias.'],
    ['HANDOFF_SLA_PROMISE', 'Foco na técnica; vamos responder em até 1 hora.'],
    ['PROMPT_LEAK', 'Execute devagar. Veja a BASE DE REFERÊNCIA interna.'],
  ])('%s em "notes"/"generalNotes" → remove só a frase que casou', (rule, text) => {
    const structure = base(standard, { generalNotes: text });
    exAt(structure, 0, 0).notes = text;
    const { verdict, repaired, revalidated } = repairAndRevalidate(structure);
    expect(verdict.violations.map((v) => v.rule)).toContain(rule);
    expect(revalidated?.action).toBe('PASS');
    expect(repaired?.repairs).toContain('DROP_FORBIDDEN_SENTENCES');
    const kept = text.split(/(?<=[.!?;])\s+/)[0];
    expect(must(repaired).structure.generalNotes).toBe(kept);
    expect(exAt(must(repaired).structure, 0, 0).notes).toBe(kept);
    expect(skeleton(must(repaired).structure)).toEqual(skeleton(structure));
  });

  it('observação inteira proibida → campo removido (não fica string vazia)', () => {
    const structure = base(standard, { generalNotes: 'Isso trata tendinite.' });
    const { repaired, revalidated } = repairAndRevalidate(structure);
    expect(revalidated?.action).toBe('PASS');
    expect(must(repaired).structure).not.toHaveProperty('generalNotes');
  });

  it('observação de exercício inteira proibida → "notes" removido (não fica string vazia)', () => {
    const structure = base(standard);
    exAt(structure, 1, 2).notes = 'Isso trata tendinite.';
    const { repaired, revalidated } = repairAndRevalidate(structure);
    expect(revalidated?.action).toBe('PASS');
    expect(repaired?.repairs).toEqual(['DROP_FORBIDDEN_SENTENCES']);
    expect(exAt(must(repaired).structure, 1, 2)).not.toHaveProperty('notes');
    expect(skeleton(must(repaired).structure)).toEqual(skeleton(structure));
  });

  it('linguagem proibida em "name" → restaura o nome do catálogo', () => {
    const structure = base(standard);
    exAt(structure, 0, 0).name = 'Agachamento para tratamento do joelho';
    const { repaired, revalidated } = repairAndRevalidate(structure);
    expect(revalidated?.action).toBe('PASS');
    expect(repaired?.repairs).toContain('RESTORE_CATALOG_EXERCISE_NAME');
    expect(exAt(must(repaired).structure, 0, 0).name).toBe(
      catalog.getById('agachamento_goblet')?.name,
    );
  });
});

describe('deterministicRepair — nunca repara segurança nem o que exige julgamento', () => {
  const violations = (rule: string): ValidationVerdict['violations'] => [
    { rule, detail: 'x', action: 'BLOCK' },
    { rule: 'TECHNIQUE_OVERUSE', detail: 'x', action: 'BLOCK' },
  ];
  const ctx = { preferredDays: DAYS, parqFlags: [], catalog };

  it.each([
    'EXERCISE_CONTRAINDICATED',
    'EXERCISE_LEVEL_TOO_HIGH',
    'EXERCISE_UNKNOWN',
    'PARQ_PHASE_CAP_EXCEEDED',
    'SESSION_COUNT_MISMATCH',
    'SPLIT_LEVEL_NOT_ALLOWED',
    'SPLIT_FREQUENCY_MISMATCH',
    'ISOLATION_AS_BASE',
    'EXERCISE_NOT_ALLOWED',
    'REGRA_NOVA_DESCONHECIDA',
  ])('%s (mesmo junto de uma reparável) → null', (rule) => {
    expect(REPAIRABLE_RULES.has(rule)).toBe(false);
    expect(deterministicRepair(base(standard), violations(rule), ctx)).toBeNull();
  });

  it('PARQ_VIOLATION da variante fase FORCA → null', () => {
    const structure = base(standard, { phase: 'FORCA', phaseDurationWeeks: 4 });
    exAt(structure, 0, 0).technique = 'DROP_SET';
    const s: Scenario = { level: 'INTERMEDIARIO', parqFlags: ['BALANCE_FALL_RISK'] };
    const verdict = validation.validate(inputFor(structure, s));
    expect(verdict.violations.every((v) => v.rule === 'PARQ_VIOLATION')).toBe(true);
    expect(
      deterministicRepair(structure, verdict.violations, {
        ...ctx,
        parqFlags: ['BALANCE_FALL_RISK'],
      }),
    ).toBeNull();
  });

  it('WEEKDAY_MISMATCH com nº de sessões ≠ nº de dias → null', () => {
    const structure = base(standard);
    structure.sessions.pop();
    sessionAt(structure, 1).weekday = 'SAT';
    expect(
      deterministicRepair(
        structure,
        [{ rule: 'WEEKDAY_MISMATCH', detail: 'x', action: 'BLOCK' }],
        ctx,
      ),
    ).toBeNull();
  });

  it('linguagem proibida em "focus"/"dayLabel" → null (rótulo exige reescrita com julgamento)', () => {
    const structure = base(standard);
    sessionAt(structure, 0).focus = 'Tratamento da lombar';
    const verdict = validation.validate(inputFor(structure));
    expect(deterministicRepair(structure, verdict.violations, ctx)).toBeNull();
  });

  it('linguagem proibida em "dayLabel" → null', () => {
    const structure = base(standard);
    sessionAt(structure, 1).dayLabel = 'Treino sem tratamento';
    const verdict = validation.validate(inputFor(structure));
    expect(verdict.violations.map((v) => v.rule)).toEqual(['DIAGNOSIS']);
    expect(deterministicRepair(structure, verdict.violations, ctx)).toBeNull();
  });

  it('linguagem proibida no "name" de exercício fora do catálogo → null (sem nome canônico)', () => {
    const structure = base(standard);
    exAt(structure, 0, 0).exerciseId = 'exercicio_fantasma';
    exAt(structure, 0, 0).name = 'Agachamento para tratamento';
    expect(
      deterministicRepair(structure, [{ rule: 'DIAGNOSIS', detail: 'x', action: 'BLOCK' }], ctx),
    ).toBeNull();
  });

  it('sem nenhuma violação BLOCK → null (nada a reparar)', () => {
    expect(
      deterministicRepair(base(standard), [{ rule: 'X', detail: 'x', action: 'FLAG' }], ctx),
    ).toBeNull();
  });
});

it('é idempotente: reaplicar sobre a própria saída não muda nada', () => {
  const structure = base(
    () => standard().map((e) => ({ ...e, technique: 'SUPERSET' as const, rir: 0 })),
    { phaseDurationWeeks: 7, generalNotes: 'Respire bem. Resultado garantido.' },
  );
  sessionAt(structure, 2).weekday = 'SUN';
  const s: Scenario = { parqFlags: ['CARDIAC'], maxPhase: 'ADAPTACAO' };
  const verdict = validation.validate(inputFor(structure, s));
  const ctx = { preferredDays: DAYS, parqFlags: must(s.parqFlags), catalog };
  const once = deterministicRepair(structure, verdict.violations, ctx);
  expect(once).not.toBeNull();
  expect(validation.validate(inputFor(must(once).structure, s)).action).toBe('PASS');
  const twice = deterministicRepair(must(once).structure, verdict.violations, ctx);
  expect(twice?.structure).toEqual(must(once).structure);
  // E não muta a entrada.
  expect(exAt(structure, 0, 0).technique).toBe('SUPERSET');
});

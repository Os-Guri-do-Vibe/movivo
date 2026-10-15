import type { ProtocolExercise, ProtocolStructure, Weekday } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import { PHASE_DURATION_WEEKS_RANGE } from '../protocol-timeline';
import { planTrainingWeekdays, WEEK_ORDER } from '../training-days';
import { type ValidateProtocolInput, ValidationService, violationKey } from './validation.service';

const service = new ValidationService();
const ALL_DAYS: Weekday[] = [...WEEK_ORDER];

function exercise(exerciseId: string, name: string, over: Partial<ProtocolExercise> = {}) {
  return {
    exerciseId,
    name,
    sets: 3,
    reps: { min: 8, max: 12 },
    loadStrategy: 'BODYWEIGHT' as const,
    restSeconds: 60,
    ...over,
  };
}

/** Uma sessão limpa (multiarticulares) por dia informado. */
function structureOn(weekdays: ReadonlyArray<Weekday | undefined>): ProtocolStructure {
  return {
    promptVersion: 'test',
    goal: 'GAIN_MUSCLE',
    phase: 'ADAPTACAO',
    phaseDurationWeeks: PHASE_DURATION_WEEKS_RANGE.ADAPTACAO.minWeeks,
    weeklyFrequency: weekdays.length,
    sessions: weekdays.map((weekday, i) => ({
      dayLabel: `Treino ${i + 1}`,
      ...(weekday ? { weekday } : {}),
      focus: 'Corpo inteiro',
      exercises: [
        exercise('flexao', 'Flexão'),
        exercise('agachamento_goblet', 'Agachamento Goblet'),
      ],
    })),
  };
}

function input(
  structure: ProtocolStructure,
  constraints: Partial<ValidateProtocolInput['constraints']> = {},
): ValidateProtocolInput {
  return { structure, constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], ...constraints } };
}

const rules = (structure: ProtocolStructure, constraints = {}) =>
  service.validate(input(structure, constraints)).violations.map((v) => v.rule);

describe('ValidationService — disponibilidade semanal é o teto (achado 2026-10-15)', () => {
  it('4 disponíveis + 7 preferidos: 7 sessões é BLOCK por exceder a disponibilidade', () => {
    const verdict = service.validate(
      input(structureOn(ALL_DAYS), { daysPerWeek: 4, preferredDays: ALL_DAYS }),
    );
    expect(verdict.action).toBe('BLOCK_FALLBACK');
    expect(verdict.violations.map((v) => v.rule)).toContain('WEEKLY_SESSIONS_EXCEED_AVAILABILITY');
  });

  it('4 disponíveis + 7 preferidos: 4 sessões em 4 dos preferidos passa', () => {
    expect(
      service.validate(
        input(structureOn(['MON', 'TUE', 'THU', 'SAT']), {
          daysPerWeek: 4,
          preferredDays: ALL_DAYS,
        }),
      ).action,
    ).toBe('PASS');
  });

  it.each([1, 2, 3, 4, 5, 6, 7])(
    '%i disponível(is) × várias combinações de preferidos: a distribuição planejada passa, uma sessão a mais bloqueia',
    (days) => {
      const combos: Weekday[][] = [ALL_DAYS, [], ['MON', 'WED'], ['SAT', 'SUN', 'TUE'], ['FRI']];
      for (const preferredDays of combos) {
        const plan = planTrainingWeekdays(days, preferredDays);
        const constraints = { daysPerWeek: days, preferredDays };
        expect(rules(structureOn(plan), constraints)).toEqual([]);
        if (days < 7) {
          const extra = WEEK_ORDER.find((day) => !plan.includes(day)) as Weekday;
          expect(rules(structureOn([...plan, extra]), constraints)).toContain(
            'WEEKLY_SESSIONS_EXCEED_AVAILABILITY',
          );
        }
      }
    },
  );

  it('menos sessões que a disponibilidade é SESSION_COUNT_MISMATCH (não excesso)', () => {
    expect(rules(structureOn(['MON', 'WED']), { daysPerWeek: 3, preferredDays: [] })).toEqual([
      'SESSION_COUNT_MISMATCH',
    ]);
  });

  it('sessão em dia fora dos preferidos quando há preferidos suficientes → WEEKDAY_MISMATCH', () => {
    expect(
      rules(structureOn(['MON', 'TUE']), { daysPerWeek: 2, preferredDays: ['MON', 'WED', 'FRI'] }),
    ).toEqual(['WEEKDAY_MISMATCH']);
  });

  it('5 disponíveis + 2 preferidos: os dois preferidos precisam estar entre as 5 sessões', () => {
    const preferredDays: Weekday[] = ['MON', 'WED'];
    expect(
      rules(structureOn(['MON', 'TUE', 'WED', 'THU', 'SAT']), { daysPerWeek: 5, preferredDays }),
    ).toEqual([]);
    expect(
      rules(structureOn(['MON', 'TUE', 'THU', 'FRI', 'SAT']), { daysPerWeek: 5, preferredDays }),
    ).toEqual(['WEEKDAY_MISMATCH']);
  });

  it('duas sessões no mesmo dia é treino extra disfarçado → DUPLICATE_WEEKDAY', () => {
    expect(
      rules(structureOn(['MON', 'MON', 'WED']), { daysPerWeek: 3, preferredDays: ALL_DAYS }),
    ).toContain('DUPLICATE_WEEKDAY');
  });

  it('weeklyFrequency declarado acima das sessões com dia fixo → WEEKLY_FREQUENCY_INCONSISTENT', () => {
    const structure = { ...structureOn(['MON', 'WED']), weeklyFrequency: 4 };
    expect(rules(structure, { daysPerWeek: 2, preferredDays: ['MON', 'WED'] })).toContain(
      'WEEKLY_FREQUENCY_INCONSISTENT',
    );
  });

  it('sem dia fixo, A/B revezando em weeklyFrequency dias continua válido e conta pela frequência', () => {
    const alternating = { ...structureOn([undefined, undefined]), weeklyFrequency: 3 };
    expect(rules(alternating, { daysPerWeek: 3, preferredDays: [] })).toEqual([]);
    expect(
      rules({ ...alternating, weeklyFrequency: 5 }, { daysPerWeek: 3, preferredDays: [] }),
    ).toEqual(['WEEKLY_SESSIONS_EXCEED_AVAILABILITY']);
  });

  it('sem dias preferidos, sessão sem dia no meio de sessões com dia fixo é WEEKDAY_MISMATCH', () => {
    expect(rules(structureOn(['MON', undefined]), { daysPerWeek: 2, preferredDays: [] })).toEqual([
      'WEEKDAY_MISMATCH',
    ]);
  });

  it('protocolo antigo sem daysPerWeek mantém a contagem por dias preferidos', () => {
    expect(
      rules(structureOn(['MON', 'WED', 'FRI']), { preferredDays: ['MON', 'WED', 'FRI'] }),
    ).toEqual([]);
    expect(rules(structureOn(['MON', 'WED']), { preferredDays: ['MON', 'WED', 'FRI'] })).toContain(
      'SESSION_COUNT_MISMATCH',
    );
  });
});

describe('ValidationService.validateProfessionalPrescription — decisão do profissional prevalece', () => {
  const lowerBack = { injuryTags: ['LOWER_BACK' as const], daysPerWeek: 1, preferredDays: [] };

  it('contraindicação inferida vira conflito, não bloqueio', () => {
    const structure = structureOn(['MON']);
    structure.sessions[0]?.exercises.push(
      exercise('prancha', 'Prancha', { reps: undefined, durationSeconds: 30 }),
    );
    const verdict = service.validateProfessionalPrescription(input(structure, lowerBack));
    expect(verdict.blocking).toEqual([]);
    expect(verdict.conflicts.map((v) => v.rule)).toEqual(['EXERCISE_CONTRAINDICATED']);
    // A mesma estrutura, como saída da IA, continua vetada.
    expect(service.validate(input(structure, lowerBack)).action).toBe('BLOCK_FALLBACK');
  });

  it('isolados como base da sessão é decisão profissional (caso real: Inferiores A)', () => {
    const structure = structureOn(['MON']);
    if (!structure.sessions[0]) throw new Error('fixture');
    structure.sessions[0].exercises = [
      exercise('leg_press_45_maquina', 'Leg Press 45º (Máquina)'),
      exercise('cadeira_extensora_maquina', 'Cadeira Extensora (Máquina)'),
      exercise('mesa_flexora_maquina', 'Mesa Flexora (Máquina)'),
      exercise('panturrilha_em_pe_maquina', 'Panturrilha em Pé (Máquina)'),
    ];
    const verdict = service.validateProfessionalPrescription(
      input(structure, { level: 'INTERMEDIARIO', daysPerWeek: 1, preferredDays: [] }),
    );
    expect(verdict.blocking).toEqual([]);
    expect(verdict.conflicts.map((v) => v.rule)).toEqual(['ISOLATION_AS_BASE']);
  });

  it('referência fora do catálogo nunca é superada (caso real: manual-<uuid>)', () => {
    const structure = structureOn(['MON']);
    structure.sessions[0]?.exercises.push(exercise('manual-c8b975ba', 'Abdominal na Prancha'));
    const verdict = service.validateProfessionalPrescription(input(structure, lowerBack));
    expect(verdict.blocking.map((v) => v.rule)).toEqual(['EXERCISE_UNKNOWN']);
  });

  it('exceder os dias disponíveis do aluno nunca é superado', () => {
    const verdict = service.validateProfessionalPrescription(
      input(structureOn(['MON', 'WED', 'FRI']), { daysPerWeek: 2, preferredDays: [] }),
    );
    expect(verdict.blocking.map((v) => v.rule)).toEqual(['WEEKLY_SESSIONS_EXCEED_AVAILABILITY']);
  });

  it('linguagem proibida no texto do profissional continua bloqueando', () => {
    const structure = {
      ...structureOn(['MON']),
      generalNotes: 'Resultado garantido em 4 semanas.',
    };
    const verdict = service.validateProfessionalPrescription(
      input(structure, { daysPerWeek: 1, preferredDays: [] }),
    );
    expect(verdict.blocking.length).toBeGreaterThan(0);
    expect(verdict.conflicts).toEqual([]);
  });

  it('chave de reconhecimento é estável por regra + detalhe', () => {
    expect(violationKey({ rule: 'ISOLATION_AS_BASE', detail: 'X' })).toBe('ISOLATION_AS_BASE:X');
  });
});

describe('ValidationService.validate com baseline — alteração automática sobre a versão vigente', () => {
  const constraints = { injuryTags: ['LOWER_BACK' as const], daysPerWeek: 1, preferredDays: [] };
  const withPrancha = () => {
    const structure = structureOn(['MON']);
    structure.sessions[0]?.exercises.push(
      exercise('prancha', 'Prancha', { reps: undefined, durationSeconds: 30 }),
    );
    return structure;
  };

  it('conflito já aceito na versão vigente não bloqueia uma troca que não o introduziu', () => {
    const baseline = withPrancha();
    const after = withPrancha();
    if (!after.sessions[0]) throw new Error('fixture');
    after.sessions[0].exercises[0] = exercise('flexao_inclinada', 'Flexão Inclinada');
    expect(service.validate(input(after, constraints)).action).toBe('BLOCK_FALLBACK');
    expect(service.validate(input(after, constraints), { baseline }).action).toBe('PASS');
  });

  it('o que a alteração INTRODUZ continua bloqueando', () => {
    const baseline = structureOn(['MON']);
    expect(service.validate(input(withPrancha(), constraints), { baseline }).action).toBe(
      'BLOCK_FALLBACK',
    );
  });

  it('regra de texto nunca é tolerada pela linha de base', () => {
    const baseline = { ...structureOn(['MON']), generalNotes: 'Resultado garantido.' };
    const after = { ...structureOn(['MON']), generalNotes: 'Resultado garantido sempre.' };
    expect(
      service.validate(input(after, { daysPerWeek: 1, preferredDays: [] }), { baseline }).action,
    ).toBe('BLOCK_FALLBACK');
  });
});

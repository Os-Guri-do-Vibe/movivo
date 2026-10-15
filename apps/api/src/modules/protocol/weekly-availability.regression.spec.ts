/**
 * Regressão do achado 2026-10-15 (produção): aluno com 4 dias disponíveis e 5–7 dias
 * preferidos recebia uma sessão por dia preferido. A disponibilidade agora é o teto em todas
 * as camadas: prompt, validador, correção, reparo determinístico e template de fallback.
 */
import type { ProtocolStructure, Weekday } from '@movivo/shared';
import { describe, expect, it, vi } from 'vitest';

import {
  type GenerateProtocolCommand,
  type GenerateProtocolResult,
  weeklyScheduleLines,
} from './protocol-generator.service';
import { planProtocol, type ProtocolGenerator } from './protocol-planner';
import { WEEK_ORDER } from './training-days';
import type { UserConstraints } from './user-constraints';
import { deterministicRepair } from './validation/deterministic-repair';
import { buildFallbackProtocol } from './validation/fallback-template';
import { ValidationService } from './validation/validation.service';

const ALL_DAYS: Weekday[] = [...WEEK_ORDER];

function constraintsFor(daysPerWeek: number, preferredDays: Weekday[]): UserConstraints {
  return {
    goal: 'GAIN_MUSCLE',
    level: 'INICIANTE',
    trainingStatus: 'REGULAR',
    daysPerWeek,
    preferredDays,
    location: 'FULL_GYM',
    equipment: [],
    emphasis: [],
    avoid: [],
    injuryTags: [],
    injuriesRaw: [],
    requiresProfessionalReview: false,
    parqTags: [],
    parqTriggered: [],
  };
}

/** Protocolo com ids reais do catálogo, uma sessão por dia informado. */
function realOn(weekdays: readonly Weekday[]): ProtocolStructure {
  return {
    promptVersion: 'v1',
    goal: 'GAIN_MUSCLE',
    phase: 'ADAPTACAO',
    phaseDurationWeeks: 3,
    splitType: 'FULL_BODY',
    weeklyFrequency: weekdays.length,
    sessions: weekdays.map((weekday, i) => ({
      dayLabel: `Treino ${i + 1}`,
      weekday,
      focus: 'Corpo inteiro',
      exercises: [
        {
          exerciseId: 'agachamento_goblet',
          name: 'Agachamento Goblet',
          sets: 3,
          reps: { min: 8, max: 12 },
          loadStrategy: 'DOUBLE_PROGRESSION' as const,
          restSeconds: 60,
        },
        {
          exerciseId: 'supino_reto_halter',
          name: 'Supino Reto (Halter)',
          sets: 3,
          reps: { min: 8, max: 12 },
          loadStrategy: 'DOUBLE_PROGRESSION' as const,
          restSeconds: 60,
        },
      ],
    })),
  };
}

function result(structure: ProtocolStructure): GenerateProtocolResult {
  return {
    structure,
    provider: 'DEEPSEEK_V4_PRO',
    model: 'deepseek-v4-pro',
    attempt: 1,
    costBrl: 0.01,
    promptVersion: 'methodology+catalog',
    unknownExerciseIds: [],
  };
}

function generatorReturning(...structures: ProtocolStructure[]) {
  const queue = [...structures];
  const generate = vi.fn(async (_command: GenerateProtocolCommand) =>
    result(queue.shift() ?? (structures.at(-1) as ProtocolStructure)),
  );
  return { generate } as ProtocolGenerator & { generate: typeof generate };
}

describe('prompt: a disponibilidade é meta e teto; os preferidos só dizem em que dias', () => {
  it('4 disponíveis + 7 preferidos: exige 4 sessões escolhidas entre os preferidos', () => {
    const text = weeklyScheduleLines(constraintsFor(4, ALL_DAYS)).join('\n');
    expect(text).toContain('Dias disponíveis por semana: 4');
    expect(text).toContain('EXATAMENTE 4 sessão(ões)');
    expect(text).toContain('"weeklyFrequency": 4');
    expect(text).toContain('escolha 4 DESTES dias');
    expect(text).toContain('não ponha o mesmo grupo muscular em dias seguidos');
    expect(text).not.toContain('uma sessão por dia desta lista');
  });

  it('2 disponíveis + 2 preferidos: uma sessão em cada preferido', () => {
    const text = weeklyScheduleLines(constraintsFor(2, ['TUE', 'THU'])).join('\n');
    expect(text).toContain('nesta ordem): TUE, THU');
    expect(text).toContain('uma sessão por dia desta lista');
  });

  it('5 disponíveis + 2 preferidos: usa os dois e não inventa preferência para os demais', () => {
    const text = weeklyScheduleLines(constraintsFor(5, ['MON', 'WED'])).join('\n');
    expect(text).toContain('MON, WED — use TODOS eles');
    expect(text).toContain('As outras 3 sessão(ões) vão em outros dias');
    expect(text).toContain('Não trate esses outros dias como preferência do aluno');
  });

  it('1 disponível + 7 preferidos: uma sessão só, sem extras', () => {
    const text = weeklyScheduleLines(constraintsFor(1, ALL_DAYS)).join('\n');
    expect(text).toContain('EXATAMENTE 1 sessão(ões)');
    expect(text).toContain('Nunca acrescente sessão extra');
  });

  it('sem dias preferidos: só a meta de sessões, sem exigir dia da semana', () => {
    const text = weeklyScheduleLines(constraintsFor(3, [])).join('\n');
    expect(text).toContain('EXATAMENTE 3 sessão(ões)');
    expect(text).not.toContain('"weekday"');
  });
});

describe('planner: resposta da IA acima da frequência permitida', () => {
  const validation = new ValidationService();

  it('pede correção à IA com a violação de excesso e aceita a versão corrigida', async () => {
    const generator = generatorReturning(realOn(ALL_DAYS), realOn(['MON', 'TUE', 'THU', 'SAT']));
    const plan = await planProtocol(generator, validation, {
      userId: 'u1',
      user: {},
      constraints: constraintsFor(4, ALL_DAYS),
    });
    const correction = generator.generate.mock.calls[1]?.[0];
    expect(correction?.correction?.violations.map((v) => v.rule)).toContain(
      'WEEKLY_SESSIONS_EXCEED_AVAILABILITY',
    );
    expect(plan.usedFallbackTemplate).toBe(false);
    expect(plan.content.sessions).toHaveLength(4);
    expect(plan.content.weeklyFrequency).toBe(4);
  });

  it('persistindo o excesso, nunca corta sessões em silêncio: cai no template com exatamente a disponibilidade', async () => {
    const preferred: Weekday[] = ['MON', 'WED', 'THU', 'SAT', 'SUN'];
    const plan = await planProtocol(generatorReturning(realOn(preferred)), validation, {
      userId: 'u1',
      user: {},
      constraints: constraintsFor(4, preferred),
    });
    expect(plan.usedFallbackTemplate).toBe(true);
    expect(plan.content.sessions).toHaveLength(4);
    expect(plan.content.weeklyFrequency).toBe(4);
    const days = plan.content.sessions.map((s) => s.weekday);
    expect(days.every((day) => day !== undefined && preferred.includes(day))).toBe(true);
    expect(
      validation
        .validate({
          structure: plan.content,
          constraints: {
            goal: 'GAIN_MUSCLE',
            injuryTags: [],
            daysPerWeek: 4,
            preferredDays: preferred,
          },
        })
        .violations.map((v) => v.rule),
    ).not.toContain('WEEKLY_SESSIONS_EXCEED_AVAILABILITY');
  });

  it.each([1, 2, 3, 4, 5, 6, 7])(
    '%i disponível(is) + 7 preferidos: protocolo final nunca passa da disponibilidade',
    async (days) => {
      const plan = await planProtocol(generatorReturning(realOn(ALL_DAYS)), validation, {
        userId: 'u1',
        user: {},
        constraints: constraintsFor(days, ALL_DAYS),
      });
      expect(plan.content.sessions.length).toBe(days);
      expect(plan.content.weeklyFrequency).toBe(days);
    },
  );
});

describe('reparo determinístico de dias', () => {
  const catalog = { getById: () => undefined };

  it('contagem certa com dia fora dos preferidos → redistribui pela distribuição planejada', () => {
    const structure = realOn(['MON', 'TUE']);
    const repaired = deterministicRepair(
      structure,
      [{ rule: 'WEEKDAY_MISMATCH', detail: 'x', action: 'BLOCK' }],
      { preferredDays: ['MON', 'WED', 'FRI'], daysPerWeek: 2, parqFlags: [], catalog },
    );
    // Entre SEG/QUA/SEX, SEG+SEX dá a maior folga entre os dois treinos.
    expect(repaired?.structure.sessions.map((s) => s.weekday)).toEqual(['MON', 'FRI']);
    expect(repaired?.repairs).toContain('ASSIGN_WEEKDAYS_BY_POSITION');
  });

  it('sessão a mais nunca é "consertada" cortando: devolve null (vai para correção/template)', () => {
    const repaired = deterministicRepair(
      realOn(['MON', 'TUE', 'WED']),
      [
        { rule: 'WEEKLY_SESSIONS_EXCEED_AVAILABILITY', detail: 'x', action: 'BLOCK' },
        { rule: 'WEEKDAY_MISMATCH', detail: 'x', action: 'BLOCK' },
      ],
      { preferredDays: ['MON', 'WED'], daysPerWeek: 2, parqFlags: [], catalog },
    );
    expect(repaired).toBeNull();
  });

  it('weeklyFrequency inconsistente com a contagem certa → alinha ao número de sessões', () => {
    const structure = { ...realOn(['MON', 'WED']), weeklyFrequency: 5 };
    const repaired = deterministicRepair(
      structure,
      [{ rule: 'WEEKLY_FREQUENCY_INCONSISTENT', detail: 'x', action: 'BLOCK' }],
      { preferredDays: ['MON', 'WED'], daysPerWeek: 2, parqFlags: [], catalog },
    );
    expect(repaired?.structure.weeklyFrequency).toBe(2);
    expect(repaired?.repairs).toContain('SYNC_WEEKLY_FREQUENCY');
  });
});

describe('template de fallback respeita a disponibilidade', () => {
  it.each([
    [3, ALL_DAYS],
    [4, ALL_DAYS],
    [5, ['MON', 'WED'] as Weekday[]],
    [2, ['TUE', 'THU'] as Weekday[]],
    [1, ALL_DAYS],
  ])('%i disponível(is) → exatamente essa quantidade de sessões', (days, preferred) => {
    const content = buildFallbackProtocol('GAIN_MUSCLE', preferred, days);
    expect(content.sessions).toHaveLength(days);
    expect(content.weeklyFrequency).toBe(days);
    expect(new Set(content.sessions.map((s) => s.weekday)).size).toBe(days);
  });

  it('chamada antiga sem daysPerWeek mantém uma sessão por dia declarado', () => {
    expect(buildFallbackProtocol('GAIN_MUSCLE', ['MON', 'FRI']).sessions).toHaveLength(2);
  });
});

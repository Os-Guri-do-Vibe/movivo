import {
  biologicalSexSchema,
  coachedModalitySchema,
  daySlotSchema,
  declaredGoalKindSchema,
  declaredGoalSchema,
  DECLARED_GOAL_LABELS,
  EXTERNAL_SPORT_LABELS,
  externalSportSchema,
  lifeContextSchema,
  MEAL_SLOT_LABELS,
  mealSlotSchema,
  MEASUREMENT_LABELS,
  measurementKindSchema,
  measurementMethodSchema,
  MUSCLE_EMPHASIS_LABELS,
  muscleEmphasisRegionSchema,
  onboardingNutritionStepSchema,
  PAIN_REGION_LABELS,
  painRegionSchema,
  painTrendSchema,
  priorityPreferenceSchema,
  targetEventSchema,
  VENUES_BY_MODALITY,
  weekdaySchema,
  type AnamnesisAnswersView,
} from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import {
  AVAILABLE_LABELS,
  AVAILABLE_MINUTES_OPTIONS,
  BIOLOGICAL_SEX_ITEMS,
  COOKING_ITEMS,
  EMPHASIS_ITEMS,
  EVENT_ITEMS,
  HUNGER_ITEMS,
  LEVEL_ITEMS,
  PRIORITY_ITEMS,
  RESTRICTION_ITEMS,
  SEVERITY_ITEMS,
  SLOT_ITEMS,
  STRESS_ITEMS,
  SUPPLEMENT_ITEMS,
  TREND_ITEMS,
  VENUE_LABELS,
} from '@/components/onboarding/anamnesis-options';
import { WEEKDAY_ITEMS } from '@/components/onboarding/weekday-items';

import {
  genericValue,
  humanize,
  MEASUREMENT_METHOD_LABELS,
  readAnamnesis,
  type AnamnesisReading,
  type AnswerRow,
  type AnswerValue,
} from './anamnesis-labels';

const PARQ_NO = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'].map((questionId) => ({
  questionId,
  answer: false,
}));

/** Anamnese inicial completa, como o servidor manda (códigos e chaves técnicas). */
function fullView(overrides: Partial<Record<number, Record<string, unknown>>> = {}) {
  const steps: AnamnesisAnswersView['steps'] = [
    {
      step: 1,
      title: 'Cadastro',
      data: {
        name: 'Ana Souza',
        birthDate: '1990-07-18',
        biologicalSex: 'FEMALE',
        heightCm: 168,
        weightKg: 72.5,
        phoneNumber: '+5511912345678',
        email: 'ana@exemplo.com',
      },
    },
    {
      step: 2,
      title: 'Objetivos',
      data: {
        goal: {
          primary: 'FAT_LOSS',
          secondary: ['HYPERTROPHY', 'BODY_DEFINITION', 'RUNNING_PERFORMANCE'],
          emphasis: 'AESTHETICS',
          targetEvent: {
            kind: 'RUNNING_RACE',
            name: 'Meia do Rio',
            date: '2027-03-15',
            distanceMeters: 21100,
          },
        },
      },
    },
    {
      step: 3,
      title: 'Seu treino com a MOVIVO',
      data: {
        modalities: [
          { modality: 'STRENGTH', level: 'INTERMEDIATE', wantsToStart: false, venue: 'FULL_GYM' },
          {
            modality: 'RUNNING',
            level: 'BEGINNER',
            wantsToStart: false,
            venue: 'FULL_GYM',
            weeklyKm: 12.5,
          },
        ],
      },
    },
    {
      step: 4,
      title: 'Sua semana',
      data: {
        externalSports: [
          {
            sport: 'SWIMMING',
            label: 'Natação',
            sessionsPerWeek: 2,
            minutesPerSession: 90,
            typicalRpe: 5,
            fixedDays: ['TUE'],
          },
        ],
        windows: [
          { weekday: 'WED', slot: 'MORNING', maxMinutes: 60 },
          { weekday: 'MON', slot: 'MORNING', maxMinutes: 60 },
        ],
        variesWeekly: true,
        lifeContext: { sleepHoursTypical: 7.5 },
      },
    },
    {
      step: 5,
      title: 'Preferências de treino e saúde geral',
      data: {
        preferences: { priority: 'BALANCED', muscleEmphasis: ['GLUTES'] },
        medications: 'Losartana 50 mg\npela manhã',
      },
    },
    {
      step: 6,
      title: 'Dores e limitações',
      data: {
        pain: {
          hasPain: true,
          points: [{ region: 'KNEE', intensity: 6 }],
          trend: 'WORSENING',
          hasProfessionalExplanation: false,
          underMedicalFollowUp: false,
          hasAvoidanceRecommendation: false,
        },
      },
    },
    {
      step: 7,
      title: 'Alimentação',
      data: {
        cookingCapacity: 'BASIC',
        mealsOutsideHomePerWeek: 5,
        foodBudgetMonthlyBrl: 1200,
        mealsPerDay: 3,
        usualMeals: ['BREAKFAST', 'LUNCH', 'DINNER'],
        dietaryRestrictions: [],
        allergies: [{ allergen: 'Amendoim', severity: 'SEVERE_ALLERGY' }],
        supplements: ['CREATINE', 'OTHER'],
        supplementOther: 'Magnésio',
        hunger: 'HIGH',
      },
    },
    {
      step: 9,
      title: 'PAR-Q',
      data: {
        parq: {
          version: 'parq-2026-07-v1',
          answers: PARQ_NO.map((a) =>
            a.questionId === 'Q1' ? { ...a, answer: true, detail: 'Pressão alta controlada' } : a,
          ),
        },
        declarationsVersion: 'parq-declaracoes-2026-08-v1',
        declarations: ['TRUTHFUL', 'WILL_REPORT_CHANGES', 'MAY_REQUIRE_REVIEW'],
      },
    },
  ];
  return {
    studentName: null,
    submittedAt: '2026-11-03T17:20:00.000Z',
    flow: 'INITIAL' as const,
    steps: steps.map((s) => ({ ...s, data: overrides[s.step] ?? s.data })),
  } satisfies AnamnesisAnswersView;
}

function rowOf(reading: AnamnesisReading, label: string): AnswerRow {
  for (const section of reading.sections) {
    const row = [...section.rows, ...section.unanswered].find((r) => r.label === label);
    if (row) return row;
  }
  throw new Error(`Pergunta não encontrada: ${label}`);
}

const textOf = (value: AnswerValue | null) =>
  value && (value.kind === 'text' || value.kind === 'paragraph') ? value.text : null;

/** Tudo o que a tela escreveria, para procurar código vazado. */
function visibleStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(visibleStrings);
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .filter(([key]) => !['id', 'anchor', 'kind', 'tone'].includes(key))
      .flatMap(([, v]) => visibleStrings(v));
  }
  return [];
}

describe('readAnamnesis: formatação por tipo', () => {
  const reading = readAnamnesis(fullView());

  it('enum vira o texto que o aluno leu (objetivo, ênfase, ritmo)', () => {
    expect(textOf(rowOf(reading, 'Objetivo principal').value)).toBe('Emagrecimento');
    expect(textOf(rowOf(reading, 'Resultado que mais importa').value)).toBe(
      'Estética e composição corporal',
    );
    expect(textOf(rowOf(reading, 'Ritmo de treino').value)).toBe('Equilibrado');
    expect(textOf(rowOf(reading, 'Fome ao longo do dia').value)).toBe('Muita fome');
  });

  it('lista de enums vira chips legíveis; lista vazia vira "Nenhuma"', () => {
    expect(rowOf(reading, 'Outros objetivos').value).toEqual({
      kind: 'chips',
      items: ['Hipertrofia', 'Definição corporal', 'Correr melhor'],
    });
    expect(rowOf(reading, 'Refeições num dia comum').value).toEqual({
      kind: 'chips',
      items: ['Café da manhã', 'Almoço', 'Jantar'],
    });
    expect(textOf(rowOf(reading, 'Estilo de alimentação ou restrição').value)).toBe('Nenhuma');
    expect(rowOf(reading, 'Suplementos que usa').value).toEqual({
      kind: 'chips',
      items: ['Creatina', 'Outro: Magnésio'],
    });
  });

  it('booleano vira Sim/Não', () => {
    expect(textOf(rowOf(reading, 'Dias e horários mudam de uma semana para outra').value)).toBe(
      'Sim',
    );
    expect(textOf(rowOf(reading, 'Acompanhamento com médico ou fisioterapeuta').value)).toBe('Não');
  });

  it('número vem com unidade', () => {
    expect(textOf(rowOf(reading, 'Altura').value)).toBe('168 cm');
    expect(textOf(rowOf(reading, 'Peso').value)).toBe('72,5 kg');
    expect(textOf(rowOf(reading, 'Horas de sono').value)).toBe('7 h 30 min por noite');
    expect(textOf(rowOf(reading, 'Refeições fora de casa').value)).toBe('5 refeições por semana');
    expect(textOf(rowOf(reading, 'Orçamento mensal com alimentação').value)).toMatch(
      /^R\$\s1\.200,00$/,
    );
    expect(rowOf(reading, 'Regiões e intensidade hoje').value).toEqual({
      kind: 'pairs',
      items: [{ label: 'Joelho', value: '6 de 10' }],
    });
  });

  it('data vira dd/mm/aaaa (com a idade no nascimento) e o envio, data e hora', () => {
    expect(textOf(rowOf(reading, 'Data de nascimento').value)).toMatch(/^18\/07\/1990 · \d+ anos$/);
    const event = rowOf(reading, 'Prova ou competição com data marcada').value;
    expect(event?.kind).toBe('groups');
    if (event?.kind !== 'groups') return;
    expect(event.items[0]?.title).toBe('Meia do Rio');
    expect(event.items[0]?.rows.map((r) => [r.label, textOf(r.value)])).toEqual([
      ['Modalidade', 'Corrida'],
      ['Data da prova', '15/03/2027'],
      ['Distância', '21,1 km'],
    ]);
    expect(reading.submittedLabel).toMatch(/^Enviada em 03\/11\/2026 às \d{2}:\d{2}$/);
  });

  it('texto livre é preservado em parágrafo, com as quebras de linha', () => {
    expect(rowOf(reading, 'Medicamentos em uso').value).toEqual({
      kind: 'paragraph',
      text: 'Losartana 50 mg\npela manhã',
    });
  });

  it('blocos repetidos: modalidade com nível, local do formulário e campo opcional em branco', () => {
    const value = rowOf(reading, 'Modalidades com a MOVIVO').value;
    if (value?.kind !== 'groups') throw new Error('esperava blocos');
    const running = value.items.find((g) => g.title === 'Corrida');
    expect(running?.rows.map((r) => [r.label, textOf(r.value)])).toEqual([
      ['Já pratica hoje', 'Sim'],
      ['Nível', 'Iniciante'],
      ['Onde treina', 'Na esteira da academia'],
      ['Km por semana', '12,5 km'],
      ['Tempo nos 5 km', 'Não informou'],
    ]);
    const sport = rowOf(reading, 'Pratica outro esporte por fora').value;
    if (sport?.kind !== 'groups') throw new Error('esperava blocos');
    expect(sport.items[0]?.rows.map((r) => textOf(r.value))).toEqual([
      '2 dias',
      null,
      '1 h 30 min',
      'Moderada · esforço 5 de 10',
    ]);
  });

  it('campo sem rótulo (novo no futuro) é humanizado, nunca aparece em SNAKE_CASE', () => {
    const view = fullView({
      7: { ...fullView().steps.find((s) => s.step === 7)?.data, foo_bar: 'BAZ_QUX', newFlag: true },
    });
    const next = readAnamnesis(view);
    expect(textOf(rowOf(next, 'Foo bar').value)).toBe('Baz qux');
    expect(textOf(rowOf(next, 'New flag').value)).toBe('Sim');
    expect(humanize('FOO_BAR')).toBe('Foo bar');
    expect(humanize('someNewField')).toBe('Some new field');
    expect(genericValue('2026-01-31')).toEqual({ kind: 'text', text: '31/01/2026' });
  });

  it('nenhuma chave nem código aparece no que a tela escreve', () => {
    const strings = visibleStrings(reading.sections).concat(visibleStrings(reading.attention));
    for (const s of strings) {
      expect(s).not.toMatch(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/);
      expect(s).not.toMatch(/^(secondary|emphasis|primary|goal|lifeContext|parq)$/);
    }
  });
});

describe('readAnamnesis: etapas, saúde e vazios', () => {
  it('segue as etapas do formulário, com a opcional de corpo explicada quando não veio', () => {
    const reading = readAnamnesis(fullView());
    expect(reading.sections.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(reading.sections.find((s) => s.step === 8)?.skippedNote).toBe(
      'Etapa opcional: o aluno não registrou medidas.',
    );
    expect(reading.studentName).toBe('Ana Souza');
    expect(reading.flowLabel).toBe('Anamnese inicial');
  });

  it('na complementar não há cadastro; o nome vem do servidor', () => {
    const base = fullView();
    const reading = readAnamnesis({
      ...base,
      flow: 'COMPLEMENTARY',
      studentName: 'Bruno Lima',
      steps: base.steps.filter((s) => s.step !== 1),
    });
    expect(reading.sections[0]?.step).toBe(2);
    expect(reading.studentName).toBe('Bruno Lima');
    expect(reading.flowLabel).toBe('Anamnese complementar');
  });

  it('PAR-Q "Sim" e alergia grave vão para o topo, em linguagem humana', () => {
    const reading = readAnamnesis(fullView());
    expect(reading.parqClear).toBe(false);
    expect(reading.attention.slice(0, 2)).toEqual([
      expect.objectContaining({
        tone: 'attention',
        title: 'PAR-Q: coração/pressão alta',
        detail: 'Pressão alta controlada',
      }),
      expect.objectContaining({
        tone: 'attention',
        title: 'Alergia alimentar grave',
        detail: 'Amendoim',
      }),
    ]);
    expect(reading.attention.map((a) => a.title)).toEqual(
      expect.arrayContaining(['Dor ou desconforto ao treinar', 'Medicamento em uso']),
    );
    const q1 = reading.sections.find((s) => s.step === 9)?.rows[0];
    expect(q1?.value).toEqual({ kind: 'text', text: 'Sim', tone: 'risk' });
    expect(q1?.detail).toBe('Pressão alta controlada');
  });

  it('pergunta opcional em branco fica separada (a tela oculta por padrão)', () => {
    const reading = readAnamnesis(fullView());
    const goals = reading.sections.find((s) => s.step === 2);
    expect(goals?.unanswered.map((r) => r.label)).toEqual([
      'O que fez procurar acompanhamento agora',
    ]);
    const week = reading.sections.find((s) => s.step === 4);
    expect(week?.unanswered.map((r) => r.label)).toEqual(['Estresse no dia a dia']);
  });

  it('sim/não com texto: sem o texto, a resposta foi "Não"', () => {
    const reading = readAnamnesis(fullView());
    expect(textOf(rowOf(reading, 'Jeito de treinar que prefere').value)).toBe('Não');
    expect(textOf(rowOf(reading, 'Orientação de profissional de saúde que ainda vale').value)).toBe(
      'Não',
    );
  });
});

describe('cobertura dos rótulos', () => {
  const has = (items: readonly { value: string }[], values: readonly string[]) =>
    expect(items.map((i) => i.value).sort()).toEqual([...values].sort());

  it('cada valor dos enums do shared tem o rótulo do formulário', () => {
    has(BIOLOGICAL_SEX_ITEMS, biologicalSexSchema.options);
    has(EMPHASIS_ITEMS, declaredGoalSchema.shape.emphasis.options);
    has(EVENT_ITEMS, targetEventSchema.shape.kind.options);
    has(SLOT_ITEMS, daySlotSchema.options);
    has(STRESS_ITEMS, lifeContextSchema.shape.stressLevel.unwrap().options);
    has(PRIORITY_ITEMS, priorityPreferenceSchema.options);
    has(TREND_ITEMS, painTrendSchema.options);
    has(WEEKDAY_ITEMS, weekdaySchema.options);
    const nutrition = onboardingNutritionStepSchema.shape;
    has(COOKING_ITEMS, nutrition.cookingCapacity.options);
    has(HUNGER_ITEMS, nutrition.hunger.options);
    has(RESTRICTION_ITEMS, nutrition.dietaryRestrictions.element.options);
    has(SUPPLEMENT_ITEMS, nutrition.supplements.element.options);
    has(SEVERITY_ITEMS, nutrition.allergies.element.shape.severity.options);
    for (const modality of coachedModalitySchema.options) {
      has(LEVEL_ITEMS[modality], ['BEGINNER', 'INTERMEDIATE', 'ADVANCED']);
      for (const venue of VENUES_BY_MODALITY[modality]) {
        expect(VENUE_LABELS[modality][venue], `${modality}/${venue}`).toBeTruthy();
      }
    }
    for (const minutes of AVAILABLE_MINUTES_OPTIONS) expect(AVAILABLE_LABELS[minutes]).toBeTruthy();
  });

  it('os rótulos do shared cobrem os enums usados na leitura', () => {
    const covered = (labels: Record<string, string>, values: readonly string[]) =>
      expect(Object.keys(labels).sort()).toEqual([...values].sort());
    covered(DECLARED_GOAL_LABELS, declaredGoalKindSchema.options);
    covered(MUSCLE_EMPHASIS_LABELS, muscleEmphasisRegionSchema.options);
    covered(PAIN_REGION_LABELS, painRegionSchema.options);
    covered(MEAL_SLOT_LABELS, mealSlotSchema.options);
    covered(EXTERNAL_SPORT_LABELS, externalSportSchema.options);
    covered(MEASUREMENT_LABELS, measurementKindSchema.options);
    covered(MEASUREMENT_METHOD_LABELS, measurementMethodSchema.options);
  });
});

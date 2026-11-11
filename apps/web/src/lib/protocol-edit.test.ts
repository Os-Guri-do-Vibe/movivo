import { describe, expect, it } from 'vitest';
import type {
  PlanSession,
  ProtocolWeekModel,
  StrengthExercise,
  TrainingPlanStructure,
} from '@movivo/shared';

import {
  addExercise,
  addStrengthSession,
  BODYWEIGHT,
  canAddStrengthSession,
  catalogFacets,
  exerciseFrom,
  exerciseKeys,
  filterCatalog,
  groupIssues,
  isDirty,
  issueKey,
  moveExercise,
  moveItem,
  moveOccurrence,
  placementOf,
  removeExercise,
  removeSession,
  replaceExercise,
  swapOccurrences,
  updateSession,
  weekLayout,
  withFrequency,
  type CatalogOption,
} from './protocol-edit';

const ex = (id: string, name = id): StrengthExercise => ({
  exerciseId: id,
  name,
  sets: 3,
  reps: { min: 8, max: 12 },
  loadStrategy: 'RIR',
  rir: 2,
  restSeconds: 90,
});

const plan: TrainingPlanStructure = {
  summary: 'x',
  modalityPriorities: [{ modality: 'STRENGTH', priority: 1 }],
  phases: [{ name: 'Base', focus: 'x', weeks: 4, endsWithDeload: false }],
  sessions: [
    {
      key: 'STR_A',
      title: 'Força A',
      purpose: 'x',
      priority: 'KEY',
      weeklyFrequency: 1,
      estimatedMinutes: 50,
      estimatedRpe: 7,
      content: { modality: 'STRENGTH', focus: 'x', exercises: [ex('a'), ex('b'), ex('c')] },
    },
    {
      key: 'RUN_EASY',
      title: 'Rodagem',
      purpose: 'x',
      priority: 'IMPORTANT',
      weeklyFrequency: 1,
      estimatedMinutes: 40,
      estimatedRpe: 4,
      content: {
        modality: 'RUNNING',
        kind: 'EASY',
        terrain: 'ANY',
        segments: [{ type: 'STEADY', durationSeconds: 1800, target: { by: 'ZONE', zone: 'Z2' } }],
      },
    },
  ],
};

const ids = (structure: TrainingPlanStructure, index = 0) => {
  const content = structure.sessions[index]?.content;
  return content?.modality === 'STRENGTH' ? content.exercises.map((e) => e.exerciseId) : [];
};

const options: CatalogOption[] = [
  {
    id: 'agachamento_smith',
    name: 'Agachamento no Smith',
    measurement: 'REPS',
    muscleGroups: ['quadríceps', 'glúteo'],
    equipment: ['máquina smith'],
  },
  {
    id: 'prancha',
    name: 'Prancha',
    measurement: 'DURATION',
    muscleGroups: ['core'],
    equipment: [],
  },
  {
    id: 'elevacao_pelvica',
    name: 'Elevação pélvica',
    measurement: 'REPS',
    muscleGroups: ['glúteo'],
    equipment: ['barra'],
  },
];

const [first, second] = plan.sessions as [PlanSession, PlanSession];

describe('reordenar', () => {
  it('move um item sem mexer no original e ignora índice fora da lista', () => {
    const list = ['a', 'b', 'c'];
    expect(moveItem(list, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(list, 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(list, 0, 5)).toEqual(list);
    expect(list).toEqual(['a', 'b', 'c']);
  });

  it('reordena exercícios', () => {
    expect(ids(moveExercise(plan, 0, 2, 0))).toEqual(['c', 'a', 'b']);
    // Sessão que não é de força não tem exercício para mover.
    expect(moveExercise(plan, 1, 0, 1)).toBe(plan);
  });
});

describe('adicionar, trocar e remover do catálogo', () => {
  it('prescrição inicial segue a medida do catálogo', () => {
    expect(exerciseFrom(options[1] as CatalogOption)).toMatchObject({
      exerciseId: 'prancha',
      durationSeconds: 30,
      loadStrategy: 'BODYWEIGHT',
    });
    expect(exerciseFrom(options[0] as CatalogOption)).toMatchObject({
      reps: { min: 8, max: 12 },
      sets: 3,
      restSeconds: 90,
    });
  });

  it('adiciona no fim e respeita o limite de 15', () => {
    expect(ids(addExercise(plan, 0, options[2] as CatalogOption))).toEqual([
      'a',
      'b',
      'c',
      'elevacao_pelvica',
    ]);
    let full = plan;
    for (let i = 0; i < 20; i += 1) full = addExercise(full, 0, options[0] as CatalogOption);
    expect(ids(full)).toHaveLength(15);
  });

  it('troca mantendo séries e descanso; repetição vira tempo quando o catálogo pede', () => {
    const swapped = replaceExercise(plan, 0, 1, options[1] as CatalogOption);
    const content = swapped.sessions[0]?.content;
    const exercise = content?.modality === 'STRENGTH' ? content.exercises[1] : undefined;
    expect(exercise).toMatchObject({
      exerciseId: 'prancha',
      name: 'Prancha',
      sets: 3,
      restSeconds: 90,
      durationSeconds: 30,
      reps: undefined,
    });
  });

  it('remove, mas a sessão e o plano nunca ficam vazios', () => {
    expect(ids(removeExercise(plan, 0, 1))).toEqual(['a', 'c']);
    let one = removeExercise(removeExercise(plan, 0, 0), 0, 0);
    expect(ids(one)).toEqual(['c']);
    one = removeExercise(one, 0, 0);
    expect(ids(one)).toEqual(['c']);
    const single = removeSession(plan, 1);
    expect(single.sessions).toHaveLength(1);
    expect(removeSession(single, 0)).toBe(single);
  });

  it('adiciona sessão de musculação com chave única e prioridade da modalidade', () => {
    const next = addStrengthSession(plan, options[0] as CatalogOption);
    const added = next.sessions.at(-1);
    expect(added).toMatchObject({ key: 'STR_B', title: 'Força B', weeklyFrequency: 1 });
    expect(ids(next, 2)).toEqual(['agachamento_smith']);
    const runOnly: TrainingPlanStructure = {
      ...plan,
      modalityPriorities: [{ modality: 'RUNNING', priority: 1 }],
      sessions: [plan.sessions[1] as TrainingPlanStructure['sessions'][number]],
    };
    expect(canAddStrengthSession(runOnly)).toBe(true);
    expect(addStrengthSession(runOnly, options[0] as CatalogOption).modalityPriorities).toEqual([
      { modality: 'RUNNING', priority: 1 },
      { modality: 'STRENGTH', priority: 3 },
    ]);
  });

  it('chave estável por exercício, mesmo repetido', () => {
    expect(exerciseKeys([ex('a'), ex('b'), ex('a')])).toEqual(['a#0', 'b#0', 'a#1']);
  });
});

describe('busca no catálogo', () => {
  it('busca sem acento, por nome, músculo ou equipamento', () => {
    const by = (query: string) =>
      filterCatalog(options, { query, muscle: '', equipment: '' }).map((o) => o.id);
    expect(by('gluteo')).toEqual(['agachamento_smith', 'elevacao_pelvica']);
    expect(by('agach smith')).toEqual(['agachamento_smith']);
    expect(by('ELEVAÇÃO')).toEqual(['elevacao_pelvica']);
  });

  it('filtra por grupo muscular e equipamento, inclusive peso do corpo', () => {
    expect(
      filterCatalog(options, { query: '', muscle: 'glúteo', equipment: 'barra' }).map((o) => o.id),
    ).toEqual(['elevacao_pelvica']);
    expect(
      filterCatalog(options, { query: '', muscle: '', equipment: BODYWEIGHT }).map((o) => o.id),
    ).toEqual(['prancha']);
  });

  it('facetas em ordem alfabética, rótulo com maiúscula, peso do corpo primeiro', () => {
    const facets = catalogFacets(options);
    expect(facets.muscles.map((m) => m.label)).toEqual(['Core', 'Glúteo', 'Quadríceps']);
    expect(facets.equipment.map((e) => e.label)).toEqual([
      'Peso do corpo',
      'Barra',
      'Máquina smith',
    ]);
  });
});

describe('estado da edição', () => {
  it('detecta alterações', () => {
    expect(isDirty(plan, structuredClone(plan))).toBe(false);
    expect(isDirty(plan, updateSession(plan, 0, { ...first, title: 'Outro' }))).toBe(true);
  });

  it('aponta cada problema para a linha certa', () => {
    expect(issueKey(['sessions', 0, 'content', 'exercises', 2, 'reps'])).toBe('exercise:0:2');
    expect(issueKey(['sessions', 1, 'weeklyFrequency'])).toBe('session:1');
    expect(issueKey(['meals', 3, 'options', 0])).toBe('meal:3');
    expect(issueKey(['restDay', 'proteinG'])).toBe('targets:restDay');
    expect(issueKey(['sessions'])).toBe('plan');
    expect(issueKey([])).toBe('plan');
    const grouped = groupIssues([
      { key: 'session:0', message: 'A' },
      { key: 'session:0', message: 'A' },
      { key: 'session:0', message: 'B' },
    ]);
    expect(grouped.get('session:0')).toEqual(['A', 'B']);
  });
});

describe('semana por dia', () => {
  // A (1×), corrida (2×) e um esporte externo: 4 ocorrências na semana-modelo.
  const week: TrainingPlanStructure = {
    ...plan,
    sessions: [
      first,
      { ...second, weeklyFrequency: 2 },
      {
        key: 'EXT_1',
        title: 'Natação',
        purpose: 'x',
        priority: 'IMPORTANT',
        weeklyFrequency: 1,
        estimatedMinutes: 45,
        estimatedRpe: 5,
        content: {
          modality: 'EXTERNAL_SPORT',
          sport: 'SWIMMING',
          label: 'Natação',
          plannedMinutes: 45,
          plannedRpe: 5,
        },
      },
    ],
  };
  const model: ProtocolWeekModel = {
    sessions: [
      { weekday: 'MON', slot: 'EVENING', sessionKey: 'STR_A', occurrence: 1 },
      { weekday: 'TUE', slot: 'EVENING', sessionKey: 'RUN_EASY', occurrence: 1 },
      { weekday: 'THU', slot: 'EVENING', sessionKey: 'EXT_1', occurrence: 1 },
      { weekday: 'FRI', slot: 'EVENING', sessionKey: 'RUN_EASY', occurrence: 2 },
    ],
    dropped: [],
  };
  const dayOf = (structure: TrainingPlanStructure, key: string) =>
    weekLayout(structure, model)
      .days.filter((day) => day.items.some((i) => structure.sessions[i.sessionIndex]?.key === key))
      .map((day) => day.weekday);

  it('mostra todas as ocorrências no dia certo: a corrida 2×/semana aparece duas vezes', () => {
    const layout = weekLayout(week, model);
    expect(layout.days.map((d) => d.weekday)).toEqual([
      'MON',
      'TUE',
      'WED',
      'THU',
      'FRI',
      'SAT',
      'SUN',
    ]);
    expect(layout.days.map((d) => d.items.length)).toEqual([1, 1, 0, 1, 1, 0, 0]);
    expect(dayOf(week, 'RUN_EASY')).toEqual(['TUE', 'FRI']);
    expect(layout.days[3]?.items[0]).toMatchObject({ external: true });
    expect(layout.unplaced).toEqual([]);
    expect(placementOf(week, model).get('RUN_EASY')).toEqual(['TUE', 'FRI']);
  });

  it('mover uma ocorrência fixa a semana inteira e não mexe em quem não foi tocado', () => {
    const moved = moveOccurrence(week, model, { key: 'RUN_EASY', occurrence: 1 }, 'SAT');
    expect(moved?.sessions.find((s) => s.key === 'RUN_EASY')?.weekdays).toEqual(['TUE', 'SAT']);
    // A semana toda ficou marcada: o que não foi tocado segue onde estava.
    expect(moved?.sessions.find((s) => s.key === 'STR_A')?.weekdays).toEqual(['MON']);
    expect(moved?.sessions.find((s) => s.key === 'EXT_1')?.weekdays).toBeUndefined();
    expect(dayOf(moved as TrainingPlanStructure, 'RUN_EASY')).toEqual(['TUE', 'SAT']);
    expect(isDirty(week, moved as TrainingPlanStructure)).toBe(true);
  });

  it('recusa a mesma sessão duas vezes no mesmo dia e índice inexistente', () => {
    expect(moveOccurrence(week, model, { key: 'RUN_EASY', occurrence: 0 }, 'FRI')).toBeNull();
    expect(moveOccurrence(week, model, { key: 'RUN_EASY', occurrence: 5 }, 'SAT')).toBeNull();
    expect(moveOccurrence(week, model, { key: 'RUN_EASY', occurrence: 0 }, 'TUE')).toBe(week);
  });

  it('arrastar uma sessão sobre outra troca os dias das duas', () => {
    const swapped = swapOccurrences(
      week,
      model,
      { key: 'STR_A', occurrence: 0 },
      { key: 'RUN_EASY', occurrence: 1 },
    );
    expect(dayOf(swapped as TrainingPlanStructure, 'STR_A')).toEqual(['FRI']);
    expect(dayOf(swapped as TrainingPlanStructure, 'RUN_EASY')).toEqual(['MON', 'TUE']);
    // Trocar com a própria sessão no mesmo dia não faz nada.
    expect(
      swapOccurrences(
        week,
        model,
        { key: 'STR_A', occurrence: 0 },
        { key: 'STR_A', occurrence: 0 },
      ),
    ).toBeNull();
  });

  it('sessão nova ou ocorrência sem dia aparece em "sem dia", não some', () => {
    const grown = updateSession(week, 0, withFrequency(first, 2));
    const layout = weekLayout(grown, model);
    expect(layout.unplaced).toEqual([{ sessionIndex: 0, occurrence: 1, external: false }]);
    const droppedModel: ProtocolWeekModel = {
      ...model,
      sessions: model.sessions.filter((s) => s.sessionKey !== 'STR_A'),
      dropped: [{ sessionKey: 'STR_A', occurrence: 1, reason: 'sem horário' }],
    };
    expect(weekLayout(week, droppedModel).unplaced).toHaveLength(1);
  });

  it('reduzir as vezes por semana descarta os dias que sobram', () => {
    const marked = { ...second, weekdays: ['TUE', 'FRI'] as ('TUE' | 'FRI')[] };
    expect(withFrequency(marked, 1).weekdays).toEqual(['TUE']);
    expect(withFrequency({ ...marked, weekdays: undefined }, 1)).not.toHaveProperty('weekdays');
    expect(withFrequency(marked, 3).weeklyFrequency).toBe(3);
  });
});

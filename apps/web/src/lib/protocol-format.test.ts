import { describe, expect, it } from 'vitest';
import type { PlanSession, StrengthExercise } from '@movivo/shared';

import {
  capitalize,
  distanceLabel,
  durationLabel,
  energyStrategyLabel,
  equipmentLabel,
  exerciseExtras,
  exerciseLine,
  humanizeCode,
  hyroxRow,
  loadLabel,
  mealLabel,
  mesocycleLabel,
  muscleLabel,
  normalizeSearch,
  planOverview,
  protocolEnd,
  repsLabel,
  restLabel,
  segmentRow,
  sessionLetter,
  sessionMeta,
  sessionTypeLabel,
  shortDate,
  targetCells,
  targetLabel,
  weekDays,
} from './protocol-format';

const squat: StrengthExercise = {
  exerciseId: 'agachamento',
  name: 'Agachamento',
  sets: 3,
  reps: { min: 8, max: 10 },
  loadStrategy: 'DOUBLE_PROGRESSION',
  rir: 2,
  restSeconds: 90,
};

function session(content: PlanSession['content'], extra: Partial<PlanSession> = {}): PlanSession {
  return {
    key: 'S_A',
    title: 'Sessão',
    purpose: 'Base.',
    priority: 'KEY',
    weeklyFrequency: 2,
    estimatedMinutes: 50,
    estimatedRpe: 7,
    content,
    ...extra,
  };
}

const ENUM = /\b[A-Z]{2,}(_[A-Z]+)+\b/;

describe('texto', () => {
  it('capitaliza e traduz códigos sem rótulo', () => {
    expect(capitalize('costas')).toBe('Costas');
    expect(humanizeCode('SLED_PUSH')).toBe('Sled push');
    expect(humanizeCode('Já em português')).toBe('Já em português');
  });

  it('busca sem acento nem caixa', () => {
    expect(normalizeSearch('  Glúteo Máquina ')).toBe('gluteo maquina');
  });
});

describe('unidades', () => {
  it('duração, descanso e distância como o profissional lê', () => {
    expect(durationLabel(45)).toBe('45 s');
    expect(durationLabel(90)).toBe('1 min 30 s');
    expect(durationLabel(120)).toBe('2 min');
    expect(durationLabel(4200)).toBe('1 h 10 min');
    expect(restLabel(0)).toBe('Sem pausa');
    expect(distanceLabel(800)).toBe('800 m');
    expect(distanceLabel(1500)).toBe('1,5 km');
    expect(distanceLabel(5000)).toBe('5 km');
  });

  it('alvo de intensidade em português', () => {
    expect(targetLabel({ by: 'ZONE', zone: 'Z2' })).toBe('Zona 2');
    expect(targetLabel({ by: 'PACE', secondsPerKm: { min: 330, max: 360 } })).toBe('5:30–6:00/km');
    expect(targetLabel({ by: 'HEART_RATE', bpm: { min: 140, max: 150 } })).toBe('140–150 bpm');
    expect(targetLabel({ by: 'RPE', rpe: { min: 4, max: 4 } })).toBe('PSE 4');
  });
});

describe('agenda', () => {
  it('monta a semana de segunda a domingo com descanso e dias antes do início', () => {
    const days = weekDays({
      weekStart: '2026-11-02',
      startsOn: '2026-11-04',
      sessions: [
        {
          date: '2026-11-04',
          slot: 'EVENING',
          sessionKey: 'S_A',
          occurrence: 1,
          title: 'Força A',
          modality: 'STRENGTH',
          priority: 'KEY',
        },
      ],
      dropped: [],
    });
    expect(days.map((d) => d.short)).toEqual(['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']);
    expect(days[0]).toMatchObject({ beforeStart: true, long: 'segunda-feira', dayMonth: '02/11' });
    expect(days[2]?.sessions).toEqual([
      { title: 'Força A', sessionKey: 'S_A', modality: 'STRENGTH', slot: 'noite' },
    ]);
    expect(days[3]).toMatchObject({ beforeStart: false, sessions: [] });
  });

  it('mesociclo, início e fim do protocolo como na revisão da v1', () => {
    const phases = [
      {
        name: 'Hipertrofia',
        focus: 'Volume.',
        weeks: 5,
        endsWithDeload: true,
        mesocycle: 'HYPERTROPHY',
      },
    ] as const;
    expect(mesocycleLabel([...phases])).toBe('Hipertrofia');
    expect(shortDate('2026-11-06')).toBe('06/11/2026');
    expect(shortDate(protocolEnd('2026-11-06', [...phases]))).toBe('11/12/2026');
    // Plano antigo, sem mesociclo: mostra o nome das fases em sequência.
    expect(
      mesocycleLabel([
        { name: 'Base', focus: 'Técnica.', weeks: 2, endsWithDeload: false },
        { name: 'Acúmulo', focus: 'Volume.', weeks: 3, endsWithDeload: false },
      ]),
    ).toBe('Base → Acúmulo');
  });
});

describe('sessões', () => {
  it('tipo da sessão sem enum cru, para todas as modalidades', () => {
    const labels = [
      sessionTypeLabel(
        session({ modality: 'STRENGTH', focus: 'Corpo inteiro', exercises: [squat] }),
      ),
      sessionTypeLabel(
        session({
          modality: 'RUNNING',
          kind: 'EASY',
          terrain: 'TREADMILL',
          segments: [{ type: 'STEADY', durationSeconds: 1800, target: { by: 'ZONE', zone: 'Z2' } }],
        }),
      ),
      sessionTypeLabel(
        session({
          modality: 'HYROX',
          kind: 'COMPROMISED_RUNNING',
          rounds: 3,
          blocks: [{ type: 'REST', durationSeconds: 60 }],
        }),
      ),
      sessionTypeLabel(
        session(
          {
            modality: 'EXTERNAL_SPORT',
            sport: 'SWIMMING',
            label: 'Natação no clube',
            plannedMinutes: 60,
            plannedRpe: 5,
          },
          { priority: 'COMPLEMENTARY' },
        ),
      ),
    ];
    expect(labels).toEqual([
      'Musculação · Corpo inteiro',
      'Corrida · Rodagem leve, esteira',
      'HYROX · Corrida comprometida · 3 voltas',
      'Natação · Natação no clube',
    ]);
    labels.forEach((text) => expect(text).not.toMatch(ENUM));
  });

  it('letras e metadados uniformes no cabeçalho', () => {
    expect([0, 1, 2].map(sessionLetter)).toEqual(['A', 'B', 'C']);
    expect(sessionMeta(session({ modality: 'STRENGTH', focus: 'x', exercises: [squat] }))).toBe(
      '2×/semana · 50 min · PSE 7',
    );
  });

  it('exercício: repetições, tempo, carga, técnica e aquecimento', () => {
    expect(repsLabel(squat)).toBe('8–10');
    expect(repsLabel({ durationSeconds: 45 })).toBe('45 s');
    expect(loadLabel(squat)).toBe('RIR 2');
    expect(loadLabel({ loadStrategy: 'FIXED_LOAD' })).toBe('Carga fixa');
    expect(exerciseLine(squat)).toBe('3 × 8–10 · descanso 1 min 30 s · RIR 2');
    expect(
      exerciseExtras({
        ...squat,
        technique: 'REST_PAUSE',
        warmup: [{ sets: 2, reps: { min: 12, max: 12 } }],
      }),
    ).toEqual(['Rest-pause', 'Aquecimento: 2 × 12']);
  });

  it('trechos de corrida e blocos de HYROX traduzidos', () => {
    expect(
      segmentRow({
        type: 'WORK',
        repeat: 6,
        distanceMeters: 800,
        target: { by: 'PACE', secondsPerKm: { min: 270, max: 280 } },
      }),
    ).toEqual({ label: 'Estímulo', volume: '6 × 800 m', target: '4:30–4:40/km', notes: undefined });
    expect(
      hyroxRow({ type: 'STATION', station: 'SLED_PUSH', distanceMeters: 50, loadKg: 102.5 }),
    ).toEqual({ label: 'Sled push', volume: '50 m · 102,5 kg', target: '—' });
    expect(hyroxRow({ type: 'STATION', station: 'WALL_BALLS', reps: 100 }).volume).toBe('100 rep.');
  });

  it('resumo do plano', () => {
    expect(
      planOverview({
        summary: 'x',
        modalityPriorities: [{ modality: 'STRENGTH', priority: 1 }],
        phases: [
          { name: 'Base', focus: 'x', weeks: 4, endsWithDeload: false },
          { name: 'Força', focus: 'x', weeks: 4, endsWithDeload: true },
        ],
        sessions: [session({ modality: 'STRENGTH', focus: 'x', exercises: [squat] })],
      }),
    ).toBe('2 sessões por semana · 2 fases · 8 semanas');
  });
});

describe('catálogo e alimentação', () => {
  it('equipamento e músculos do catálogo para leitura', () => {
    expect(equipmentLabel([])).toBe('Peso do corpo');
    expect(equipmentLabel(['máquina smith'])).toBe('Máquina smith');
    expect(muscleLabel(['quadríceps', 'glúteo'])).toBe('Quadríceps, Glúteo');
  });

  it('refeições, estratégia e metas em ordem fixa', () => {
    expect(mealLabel('AFTERNOON_SNACK')).toBe('Lanche da tarde');
    expect(energyStrategyLabel('DEFICIT')).toBe('Déficit calórico');
    expect(energyStrategyLabel('PERFORMANCE_FUELING')).toBe('Calorias para o desempenho');
    expect(
      targetCells({
        energyKcal: { min: 2000, max: 2200 },
        proteinG: 140,
        carbsG: 220,
        fatG: 60,
        fiberG: 30,
        waterMl: 2500,
      }),
    ).toEqual([
      { label: 'Caloria', value: '2000–2200 kcal' },
      { label: 'Proteína', value: '140 g' },
      { label: 'Carboidrato', value: '220 g' },
      { label: 'Gordura', value: '60 g' },
      { label: 'Fibras', value: '30 g' },
      { label: 'Água', value: '2,5 L' },
    ]);
  });
});

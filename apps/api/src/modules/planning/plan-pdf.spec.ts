import type { PlanRead } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import { buildOption, quantityLabel, type FoodCandidate } from './calc/menu';
import { pdfText, sessionLines } from './plan-pdf';
import { nutritionPlanPdf, trainingPlanPdf } from './protocol-pdf';

const plan: PlanRead = {
  firstName: 'Ana',
  strategy: {
    title: 'Força com consistência',
    rationale: ['Base primeiro.'],
    energyStrategy: 'MAINTENANCE',
    modalityFocus: ['STRENGTH', 'RUNNING'],
    indicators: [{ key: 'sessions', label: 'Sessões', source: 'ADHERENCE', direction: 'INCREASE' }],
    reviewAfterWeeks: 6,
    openQuestions: [],
    studentMessage: 'Vamos no seu ritmo 💪',
  },
  milestones: [],
  tasks: [],
  training: {
    version: 1,
    startsOn: '2026-11-03',
    structure: {
      summary: 'Duas sessões de força e uma corrida leve por semana.',
      modalityPriorities: [
        { modality: 'STRENGTH', priority: 1 },
        { modality: 'RUNNING', priority: 2 },
      ],
      phases: [
        { name: 'Adaptação', focus: 'Técnica e volume baixo.', weeks: 4, endsWithDeload: true },
      ],
      sessions: [
        {
          key: 'FORCA_A',
          title: 'Força A',
          purpose: 'Base de força.',
          priority: 'KEY',
          weeklyFrequency: 2,
          estimatedMinutes: 50,
          estimatedRpe: 7,
          content: {
            modality: 'STRENGTH',
            focus: 'Corpo inteiro',
            exercises: [
              {
                exerciseId: 'agachamento',
                name: 'Agachamento',
                sets: 3,
                reps: { min: 8, max: 10 },
                loadStrategy: 'RIR',
                rir: 2,
                restSeconds: 90,
              },
              {
                exerciseId: 'prancha',
                name: 'Prancha',
                sets: 3,
                durationSeconds: 30,
                loadStrategy: 'BODYWEIGHT',
                restSeconds: 45,
              },
            ],
          },
        },
        {
          key: 'CORRIDA_LEVE',
          title: 'Corrida leve',
          purpose: 'Base aeróbia.',
          priority: 'IMPORTANT',
          weeklyFrequency: 1,
          estimatedMinutes: 35,
          estimatedRpe: 4,
          content: {
            modality: 'RUNNING',
            kind: 'INTERVALS',
            terrain: 'ANY',
            segments: [
              { type: 'WARMUP', durationSeconds: 600, target: { by: 'ZONE', zone: 'Z1' } },
              {
                type: 'WORK',
                repeat: 6,
                distanceMeters: 800,
                target: { by: 'PACE', secondsPerKm: { min: 270, max: 285 } },
              },
            ],
          },
        },
      ],
    },
    upcoming: [
      {
        date: '2026-11-03',
        slot: 'EVENING',
        status: 'PLANNED',
        planSessionKey: 'FORCA_A',
        title: 'Força A',
        modality: 'STRENGTH',
        minutes: 50,
      },
    ],
  },
  nutrition: {
    version: 1,
    startsOn: '2026-11-03',
    structure: {
      strategy: 'MAINTENANCE',
      summary: 'Comer bem na rotina real.',
      trainingDay: {
        energyKcal: { min: 2000, max: 2200 },
        proteinG: 120,
        carbsG: 250,
        fatG: 70,
        fiberG: 30,
        waterMl: 2500,
      },
      restDay: {
        energyKcal: { min: 1800, max: 2000 },
        proteinG: 120,
        carbsG: 200,
        fatG: 65,
        fiberG: 30,
        waterMl: 2500,
      },
      meals: [
        {
          slot: 'BREAKFAST',
          energyShare: 0.4,
          proteinG: 40,
          guidance: 'Proteína + fruta.',
          examples: ['Ovos e pão'],
        },
        {
          slot: 'LUNCH',
          energyShare: 0.6,
          proteinG: 80,
          guidance: 'Prato completo.',
          examples: ['Arroz, feijão e frango'],
        },
      ],
      guidelines: ['Beba água ao longo do dia.'],
      supplements: [],
    },
  },
};

describe('plan-pdf', () => {
  it('gera os dois PDFs a partir do plano vigente', async () => {
    const training = await trainingPlanPdf(plan);
    const nutrition = await nutritionPlanPdf(plan);
    expect(training.subarray(0, 5).toString()).toBe('%PDF-');
    expect(nutrition.subarray(0, 5).toString()).toBe('%PDF-');
    expect(training.length).toBeGreaterThan(2000);
  });

  it('detalha a sessão: séries, reps, descanso, reserva, tempo e ritmo', () => {
    const [strength, running] = plan.training?.structure.sessions ?? [];
    if (!strength || !running) throw new Error('fixture');
    expect(sessionLines(strength)).toEqual([
      'Corpo inteiro',
      '1. Agachamento — 3 × 8–10 reps · descanso 90 s · 2 rep. em reserva',
      '2. Prancha — 3 × 30 s · descanso 45 s',
    ]);
    expect(sessionLines(running)).toEqual([
      'Intervalado',
      'Aquecimento: 10 min · zona 1',
      'Estímulo: 6 × 800 m · ritmo 4:30–4:45/km',
    ]);
  });

  it('tira o que a fonte padrão do PDF não desenha (emoji), mantendo acentos', () => {
    expect(pdfText('Vamos no seu ritmo 💪 — ação')).toBe('Vamos no seu ritmo  — ação');
  });
});

describe('protocol-pdf com cardápio', () => {
  const food = (
    id: string,
    name: string,
    category: string,
    k: number,
    p: number,
    c: number,
    g: number,
  ): FoodCandidate => ({
    id,
    name,
    category,
    energyKcal: k,
    proteinG: p,
    carbsG: c,
    fatG: g,
    fiberG: 1,
  });
  const foods = new Map(
    [
      food('ovo', 'Ovo, cozido', 'Ovos e derivados', 146, 13.3, 0.6, 9.5),
      food('pao', 'Pão, integral', 'Cereais e derivados', 253, 9.4, 49.9, 3.4),
      food('aveia', 'Aveia, flocos', 'Cereais e derivados', 394, 13.9, 66.6, 8.5),
      food('banana', 'Banana', 'Frutas e derivados', 98, 1.3, 26, 0.1),
    ].map((f) => [f.id, f]),
  );

  it('gera o PDF alimentar com opções, quantidades e trocas', async () => {
    const { option } = buildOption(
      {
        title: 'Ovos, pão e banana',
        estimatedCostBrl: 5,
        items: [
          {
            foodId: 'ovo',
            grams: 150,
            unit: { singular: 'ovo', plural: 'ovos', grams: 50 },
            swaps: [],
          },
          { foodId: 'pao', grams: 50, swaps: [{ foodId: 'aveia' }] },
          { foodId: 'banana', grams: 100, swaps: [] },
        ],
      },
      { energyKcal: 500, proteinG: 30 },
      foods,
      'm',
    );
    const withMenu: PlanRead = {
      ...plan,
      nutrition: {
        version: 1,
        startsOn: '2026-11-03',
        structure: {
          strategy: 'MAINTENANCE',
          summary: 'Comer bem na rotina real.',
          trainingDay: {
            energyKcal: { min: 2000, max: 2200 },
            proteinG: 120,
            carbsG: 250,
            fatG: 70,
            fiberG: 30,
            waterMl: 2500,
          },
          restDay: {
            energyKcal: { min: 1800, max: 2000 },
            proteinG: 120,
            carbsG: 200,
            fatG: 65,
            fiberG: 30,
            waterMl: 2500,
          },
          meals: [
            {
              slot: 'BREAKFAST',
              energyShare: 0.5,
              proteinG: 30,
              guidance: 'Proteína e fruta.',
              examples: [option.title],
              options: [option, option],
            },
            {
              slot: 'LUNCH',
              energyShare: 0.5,
              proteinG: 30,
              guidance: 'Prato completo.',
              examples: ['Arroz e feijão'],
            },
          ],
          guidelines: ['Beba água.'],
          supplements: [],
          estimatedDailyCostBrl: 18,
        },
      },
    };
    const pdf = await nutritionPlanPdf(withMenu);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(20_000);
  });

  it('descreve a quantidade com a medida caseira quando há', () => {
    expect(quantityLabel({ grams: 100, unit: { singular: 'ovo', plural: 'ovos' }, units: 2 })).toBe(
      '2 ovos',
    );
    expect(
      quantityLabel({ grams: 50, unit: { singular: 'fatia', plural: 'fatias' }, units: 1 }),
    ).toBe('1 fatia');
    expect(quantityLabel({ grams: 120 })).toBe('120 g');
    expect(quantityLabel({ grams: 250, name: 'Leite, de vaca, integral' })).toBe('250 ml');
    // Legado: meia unidade não vira "3,5 ovos"; cai para gramas.
    expect(
      quantityLabel({ grams: 175, unit: { singular: 'ovo', plural: 'ovos' }, units: 3.5 }),
    ).toBe('175 g');
  });
});

import type { PlanRead } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import { buildOption, quantityLabel, type FoodCandidate } from './calc/menu';
import { pdfText, sessionLines } from './plan-pdf';
import { nutritionPlanPdf, protocolPdfFileName, trainingPlanPdf } from './protocol-pdf';

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
    baseWeek: [{ weekday: 'TUE', slot: 'EVENING', planSessionKey: 'FORCA_A' }],
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

  it('o PDF de treino traz o cabeçalho do aluno e os treinos pelos dias da semana', async () => {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const week = structuredClone(plan);
    const [strength, running] = week.training?.structure.sessions ?? [];
    if (!strength || !running) throw new Error('fixture');
    strength.weekdays = ['MON', 'THU'];
    running.weekdays = ['THU'];
    const buffer = await trainingPlanPdf(week, {
      fullName: 'Ana Souza Lima',
      ageYears: 34,
      initialWeightKg: 68.5,
      heightCm: 168,
      biologicalSex: 'FEMALE',
    });
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    for (const expected of [
      'Ana Souza Lima',
      '34 anos',
      '68,5 kg',
      '168 cm',
      'Feminino',
      'Peso inicial',
      'Data final do protocolo',
    ]) {
      expect(text).toContain(expected);
    }
    // O título do dia tem espaçamento entre letras, que a extração separa.
    const compact = text.replace(/\s+/g, '');
    expect(compact).toContain('SEGUNDA');
    expect(compact).toContain('QUINTA');
    expect(text).not.toContain('Versão do protocolo');
    expect(text).not.toContain('Duração');
    expect(text).not.toContain('Planejado com apoio de inteligência artificial');
    // Os dois treinos de quinta aparecem no mesmo dia; a repetição de "Força A" só referencia.
    expect(text).toContain('mesmo treino de segunda');
    expect(compact.indexOf('SEGUNDA')).toBeLessThan(compact.indexOf('QUINTA'));
  });

  it('sem dia marcado pelo profissional, usa a semana-base', async () => {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const buffer = await trainingPlanPdf(plan);
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    const compact = text.replace(/\s+/g, '');
    expect(compact).toContain('TERÇA');
    expect(compact).toContain('DIAADEFINIR'); // a corrida ainda não tem dia
  });

  it('mostra a distribuição fixa da semana-base, não a agenda da primeira semana', async () => {
    const { extractText, getDocumentProxy } = await import('unpdf');
    // Liberado numa quarta: a primeira semana pôs Força A na quarta; a semana-base, na segunda.
    const midweek = structuredClone(plan);
    if (!midweek.training) throw new Error('fixture');
    midweek.training.upcoming = midweek.training.upcoming.map((s) => ({
      ...s,
      date: '2026-11-11',
    }));
    midweek.training.baseWeek = [
      { weekday: 'MON', slot: 'ANY', planSessionKey: 'FORCA_A' },
      { weekday: 'FRI', slot: 'ANY', planSessionKey: 'CORRIDA_LEVE' },
    ];
    const buffer = await trainingPlanPdf(midweek);
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    const compact = text.replace(/\s+/g, '');
    expect(compact).toContain('SEGUNDA');
    expect(compact).toContain('SEXTA');
    expect(compact).not.toContain('QUARTA');
    expect(compact).not.toContain('DIAADEFINIR');
  });

  it('o PDF alimentar diz "Caloria" (não "Energia") e traz o nome do alimento como se fala', async () => {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const withMenu = structuredClone(plan);
    const meal = withMenu.nutrition?.structure.meals[0];
    if (!meal) throw new Error('fixture');
    meal.options = [
      {
        title: 'Ovos com pão',
        items: [
          {
            foodId: 'ovo',
            name: 'Ovo, de galinha, inteiro, cozido',
            grams: 100,
            energyKcal: 146,
            swaps: [{ foodId: 'pao', name: 'Pão, trigo, francês', grams: 50, energyKcal: 150 }],
          },
        ],
        totals: { energyKcal: 146, proteinG: 13, carbsG: 1, fatG: 9, fiberG: 0 },
        estimatedCostBrl: 3,
      },
    ] as never;
    const buffer = await nutritionPlanPdf(withMenu);
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    expect(text).toContain('Caloria do dia');
    expect(text).not.toMatch(/Energia do dia/);
    expect(text).toContain('Ovo de galinha cozido');
    expect(text).toContain('Pão francês');
    expect(text).not.toContain('Ovo, de galinha');
  });

  it('o PDF alimentar usa o nome completo e as datas do protocolo de treino', async () => {
    const { extractText, getDocumentProxy } = await import('unpdf');
    const buffer = await nutritionPlanPdf(plan, {
      fullName: 'Ana Souza Lima',
      ageYears: null,
      initialWeightKg: null,
      heightCm: null,
      biologicalSex: null,
    });
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    const energyChart = text.split('Sobre o seu plano alimentar')[0] ?? text;

    expect(text).toContain('Ana Souza Lima');
    expect(text).toContain('Data início do plano');
    expect(text).toContain('03/11/2026');
    expect(text).toContain('Data fim do plano');
    expect(text).toContain('30/11/2026');
    expect(text).not.toContain('Versão do plano');
    expect(text).not.toContain('Planejado com apoio de inteligência artificial');
    expect(text).not.toContain('A barra escura é a caloria mínima do dia');
    expect(text).toContain('2.200 kcal');
    expect(text).toContain('2.000 kcal');
    expect(energyChart).not.toContain('2.000–2.200 kcal');
    expect(energyChart).not.toContain('1.800–2.000 kcal');
  });

  it('gera nomes de arquivo de PDF seguros, com o nome completo em slug', () => {
    expect(protocolPdfFileName('treino', 'João da Silva')).toBe(
      'protocolo-de-treino-joao-da-silva.pdf',
    );
    expect(protocolPdfFileName('alimentacao', null)).toBe('plano-alimentar-aluno.pdf');
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

    // Com refeições livres o documento ganha a seção; plano antigo (sem o campo) segue igual.
    const structure = withMenu.nutrition?.structure;
    if (!structure || !withMenu.nutrition) throw new Error('fixture sem plano alimentar');
    const withFree = await nutritionPlanPdf({
      ...withMenu,
      nutrition: {
        ...withMenu.nutrition,
        structure: {
          ...structure,
          freeMeals: {
            perWeek: 1,
            options: [
              {
                title: 'Combo de hambúrguer',
                description: 'Hambúrguer artesanal com batata frita média',
                energyKcal: 950,
                fitTip: 'No dia, capriche na proteína do almoço e deixe o lanche leve.',
              },
              {
                title: 'Pizza',
                description: '3 fatias (calabresa, margherita, frango com catupiry)',
                energyKcal: 850,
                fitTip: 'Salada grande antes e jantar simples depois.',
              },
              {
                title: 'Sushi',
                description: '14 peças variadas e 1 temaki',
                energyKcal: 800,
                fitTip: 'Café da manhã leve no dia.',
              },
            ],
            guidance: 'Pode escolher outra: me conte no WhatsApp e eu ajudo a encaixar.',
          },
        },
      },
    });
    expect(withFree.subarray(0, 5).toString()).toBe('%PDF-');
    expect(withFree.length).toBeGreaterThan(pdf.length);
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

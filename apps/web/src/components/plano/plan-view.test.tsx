import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { PlanRead } from '@movivo/shared';

import { dayLabel, PlanView } from './plan-view';

const PLAN: PlanRead = {
  firstName: 'Ana',
  strategy: {
    title: 'Recomposição corporal',
    rationale: ['Você quer ganhar massa e tem gordura a perder ao mesmo tempo.'],
    energyStrategy: 'RECOMPOSITION',
    modalityFocus: ['STRENGTH'],
    indicators: [{ key: 'waist', label: 'Cintura', source: 'BODY', direction: 'DECREASE' }],
    reviewAfterWeeks: 6,
    openQuestions: [],
    studentMessage: 'Vamos treinar força e ajustar a alimentação, no seu ritmo.',
  },
  milestones: [
    {
      milestone: {
        indicatorKey: 'waist',
        description: 'Cintura 2 cm menor',
        condition: { kind: 'CHANGE_BY', delta: -2 },
        dueInWeeks: 8,
      },
      dueOn: '2026-12-30',
      status: 'PENDING',
    },
  ],
  tasks: [
    { title: 'Treinar 3 vezes', target: 3, progress: 1, windowEnd: '2026-11-08', status: 'OPEN' },
  ],
  training: {
    version: 1,
    startsOn: '2026-11-04',
    structure: {
      summary: 'Força de corpo inteiro, três vezes por semana.',
      modalityPriorities: [{ modality: 'STRENGTH', priority: 1 }],
      phases: [{ name: 'Base', focus: 'Adaptação', weeks: 4, endsWithDeload: false }],
      sessions: [
        {
          key: 'FORCA_A',
          title: 'Força A',
          purpose: 'Base de força',
          priority: 'KEY',
          weeklyFrequency: 3,
          estimatedMinutes: 50,
          estimatedRpe: 6,
          content: {
            modality: 'STRENGTH',
            focus: 'Corpo todo',
            exercises: [
              {
                exerciseId: 'agachamento_barra',
                name: 'Agachamento com barra',
                sets: 3,
                reps: { min: 8, max: 12 },
                loadStrategy: 'DOUBLE_PROGRESSION',
                rir: 2,
                restSeconds: 90,
              },
            ],
          },
        },
      ],
    },
    upcoming: [
      {
        date: '2026-11-05',
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
    startsOn: '2026-11-04',
    structure: {
      strategy: 'RECOMPOSITION',
      summary: 'Proteína distribuída ao longo do dia.',
      trainingDay: {
        energyKcal: { min: 2300, max: 2450 },
        proteinG: 170,
        carbsG: 250,
        fatG: 70,
        fiberG: 35,
        waterMl: 3000,
      },
      restDay: {
        energyKcal: { min: 2100, max: 2250 },
        proteinG: 170,
        carbsG: 200,
        fatG: 70,
        fiberG: 35,
        waterMl: 3000,
      },
      meals: [
        {
          slot: 'BREAKFAST',
          energyShare: 0.5,
          proteinG: 40,
          guidance: 'Comece com proteína.',
          examples: ['Ovos com pão'],
        },
        {
          slot: 'LUNCH',
          energyShare: 0.5,
          proteinG: 50,
          guidance: 'Prato completo.',
          examples: ['Arroz, feijão e frango'],
        },
      ],
      guidelines: ['Beba água ao longo do dia.'],
      supplements: [],
    },
  },
};

describe('PlanView', () => {
  it('mostra estratégia, metas, treino e alimentação', () => {
    render(<PlanView plan={PLAN} />);
    expect(screen.getByRole('heading', { name: /Ana, este é o seu plano/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recomposição corporal' })).toBeInTheDocument();
    expect(screen.getByText(/Vamos treinar força/)).toBeInTheDocument();
    expect(screen.getByText('Treinar 3 vezes')).toBeInTheDocument();
    expect(screen.getByText(/Cintura 2 cm menor/)).toBeInTheDocument();
    expect(screen.getByText(/Agachamento com barra — 3 × 8–12 reps/)).toBeInTheDocument();
    expect(screen.getByText('Café da manhã', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Dia de treino')).toBeInTheDocument();
  });

  it('deixa o respaldo dos profissionais e o aviso de segurança visíveis, sem a IA como autora', () => {
    render(<PlanView plan={PLAN} />);
    expect(
      screen.getByText(/profissionais de Educação Física e Nutrição da MOVIVO/),
    ).toBeInTheDocument();
    expect(screen.getByText(/não substituem acompanhamento presencial/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/inteligência artificial|\bIA\b/i);
  });

  it('funciona sem treino ou nutrição ativos', () => {
    render(<PlanView plan={{ ...PLAN, training: null, nutrition: null, strategy: null }} />);
    expect(screen.queryByText('Seu treino')).not.toBeInTheDocument();
    expect(screen.queryByText('Sua alimentação')).not.toBeInTheDocument();
  });

  it('formata o dia sem deslocar a data por fuso', () => {
    expect(dayLabel('2026-11-04', 'EVENING')).toBe('quarta, 04/11 · à noite');
    expect(dayLabel('2026-11-08', 'ANY')).toBe('domingo, 08/11');
  });
});

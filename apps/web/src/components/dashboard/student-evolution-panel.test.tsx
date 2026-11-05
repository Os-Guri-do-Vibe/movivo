import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StudentEvolution } from '@movivo/shared';

const api = vi.hoisted(() => ({ getStudentEvolution: vi.fn() }));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...api,
}));

import { ControlCenterApiError } from '@/lib/control-center-api';

import { StudentEvolutionPanel } from './student-evolution-panel';

const EVOLUTION: StudentEvolution = {
  asOf: '2026-11-03',
  weeks: [
    {
      weekStart: '2026-10-19',
      planned: 3,
      done: 3,
      missed: 0,
      plannedLoad: 900,
      realizedLoad: 940,
      avgRpe: 7,
      painReports: 0,
    },
    {
      weekStart: '2026-10-26',
      planned: 3,
      done: 2,
      missed: 1,
      plannedLoad: 900,
      realizedLoad: 600,
      avgRpe: 7.5,
      painReports: 1,
    },
  ],
  days: [
    {
      date: '2026-11-02',
      load: 300,
      energy: 4,
      sleep: 2,
      soreness: 3,
      mood: 4,
      stress: 4,
      readiness: 55,
    },
    {
      date: '2026-11-03',
      load: 0,
      energy: 3,
      sleep: 2,
      soreness: 3,
      mood: 3,
      stress: 4,
      readiness: 45,
    },
  ],
  nutritionDays: [
    {
      date: '2026-11-02',
      meals: 4,
      energyKcal: 2050,
      proteinG: 130,
      carbsG: 220,
      fatG: 65,
      waterMl: 2200,
    },
    {
      date: '2026-11-03',
      meals: 3,
      energyKcal: 1800,
      proteinG: 110,
      carbsG: 190,
      fatG: 60,
      waterMl: null,
    },
  ],
  load: {
    weeklyLoad: 600,
    previousWeeklyLoad: 940,
    acwr: 0.72,
    monotony: 1.4,
    strain: 840,
    adherenceRatio: 0.67,
    readiness: { score: 45, baseline: 70, delta: -25 },
    risks: [{ kind: 'READINESS_LOW', detail: 'prontidão 45/100, 25 pontos abaixo do normal dele' }],
  },
  measurements: [
    {
      kind: 'WEIGHT',
      points: [
        { date: '2026-09-01', value: 74 },
        { date: '2026-11-01', value: 71.5 },
      ],
    },
  ],
  strength: [],
  pain: [{ region: 'KNEE', reports: 2, maxIntensity: 5, lastOn: '2026-10-30' }],
  memory: [{ kind: 'ROUTINE', text: 'Treina de manhã, antes do trabalho', importance: 3 }],
  reassessments: [{ cycleEndedOn: '2026-11-01', status: 'SENT', submittedAt: null }],
};

beforeEach(() => api.getStudentEvolution.mockReset());

describe('StudentEvolutionPanel', () => {
  it('mostra os indicadores de carga, os sinais, a dor e a memória do aluno', async () => {
    api.getStudentEvolution.mockResolvedValue(EVOLUTION);
    render(<StudentEvolutionPanel studentId="s1" />);
    expect(await screen.findByText('Aguda:crônica')).toBeInTheDocument();
    expect(screen.getByText('0,72')).toBeInTheDocument();
    expect(screen.getByLabelText('Sinais de atenção')).toHaveTextContent('Prontidão baixa');
    expect(screen.getByText(/Treina de manhã, antes do trabalho/)).toBeInTheDocument();
    expect(screen.getByText(/intensidade máxima 5\/10/)).toBeInTheDocument();
    expect(screen.getByText('Carga por semana (sRPE)')).toBeInTheDocument();
    expect(screen.getByText('Peso (kg)')).toBeInTheDocument();
  });

  it('avisa quando a evolução não carrega', async () => {
    api.getStudentEvolution.mockRejectedValueOnce(
      new ControlCenterApiError(500, 'Falhou ao carregar.'),
    );
    render(<StudentEvolutionPanel studentId="s1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Falhou ao carregar.');
  });
});

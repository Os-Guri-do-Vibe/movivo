import type { ProtocolStructure } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import { buildRetrato, type RetratoInput } from './retrato';

// Seg/qua/sex (frequência 3). 2026-10-13 é terça; a janela vai de 2026-09-29 a 2026-10-12.
const STRUCTURE = {
  promptVersion: 't',
  goal: 'GAIN_MUSCLE',
  phase: 'ADAPTACAO',
  phaseDurationWeeks: 4,
  weeklyFrequency: 3,
  sessions: [
    { dayLabel: 'A', focus: 'Costas', exercises: [] },
    { dayLabel: 'B', focus: 'Pernas', exercises: [] },
    { dayLabel: 'C', focus: 'Peito', exercises: [] },
  ],
} as unknown as ProtocolStructure;

const NOW = new Date('2026-10-13T12:00:00.000Z');

const base = (overrides: Partial<RetratoInput> = {}): RetratoInput => ({
  now: NOW,
  firstProtocolStart: new Date('2026-04-13T12:00:00.000Z'),
  mesocycleNumber: 5,
  currentWeek: 3,
  totalWeeks: 6,
  structure: STRUCTURE,
  completedDates: new Set(),
  inProgressDates: new Set(),
  ...overrides,
});

// Dias previstos na janela (seg/qua/sex): 29/09 não, 30/09 qua, 02/10 sex, 05/10... confere abaixo.
const PLANNED = [
  '2026-09-30',
  '2026-10-02',
  '2026-10-05',
  '2026-10-07',
  '2026-10-09',
  '2026-10-12',
];

describe('buildRetrato', () => {
  it('tempo de casa em meses, mesociclo e semana', () => {
    const retrato = buildRetrato(base());
    expect(retrato.naMovivoHa).toBe('6 meses');
    expect(retrato.mesociclo).toBe(5);
    expect(retrato.semanaDoMesociclo).toBe('3 de 6');
  });

  it('tudo registrado: nada sem registro e o último treino aparece', () => {
    const retrato = buildRetrato(base({ completedDates: new Set(PLANNED) }));
    expect(retrato.ultimasDuasSemanas).toEqual({
      treinosPrevistos: 6,
      treinosRegistrados: 6,
      semRegistro: [],
    });
    expect(retrato.ultimoTreinoRegistrado).toBe('2026-10-12');
  });

  it('dia previsto sem registro entra pelo nome do dia da semana, em ordem cronológica', () => {
    const done = PLANNED.filter((day) => day !== '2026-10-07' && day !== '2026-10-12');
    const retrato = buildRetrato(base({ completedDates: new Set(done) }));
    expect(retrato.ultimasDuasSemanas.semRegistro).toEqual([
      'quarta-feira 07/10',
      'segunda-feira 12/10',
    ]);
    expect(retrato.ultimasDuasSemanas.treinosRegistrados).toBe(4);
    expect(retrato.ultimoTreinoRegistrado).toBe('2026-10-09');
  });

  it('dia de descanso nunca aparece como sem registro', () => {
    const retrato = buildRetrato(base({ completedDates: new Set(PLANNED) }));
    expect(retrato.ultimasDuasSemanas.semRegistro).toEqual([]);
    expect(retrato.ultimasDuasSemanas.treinosPrevistos).toBe(PLANNED.length);
  });

  it('treino iniciado e não finalizado não é cobrado nem contado', () => {
    const retrato = buildRetrato(
      base({
        completedDates: new Set(PLANNED.filter((day) => day !== '2026-10-12')),
        inProgressDates: new Set(['2026-10-12']),
      }),
    );
    expect(retrato.ultimasDuasSemanas.semRegistro).toEqual([]);
    expect(retrato.ultimasDuasSemanas.treinosPrevistos).toBe(5);
  });

  it('o dia da entrega do 1º protocolo e os anteriores não entram', () => {
    // Protocolo entregue na segunda 12/10: só os dias depois dele valem, e ele próprio não.
    const retrato = buildRetrato(
      base({ firstProtocolStart: new Date('2026-10-12T18:00:00.000Z') }),
    );
    expect(retrato.ultimasDuasSemanas.treinosPrevistos).toBe(0);
    expect(retrato.ultimasDuasSemanas.semRegistro).toEqual([]);
    expect(retrato.naMovivoHa).toBe('menos de 1 semana');
  });

  it('semanas e mês no singular', () => {
    expect(
      buildRetrato(base({ firstProtocolStart: new Date('2026-09-29T12:00:00.000Z') })).naMovivoHa,
    ).toBe('2 semanas');
    expect(
      buildRetrato(base({ firstProtocolStart: new Date('2026-09-06T12:00:00.000Z') })).naMovivoHa,
    ).toBe('1 mês');
  });

  it('não usa palavras que a marca não usa nas chaves nem nos valores', () => {
    const text = JSON.stringify(buildRetrato(base()));
    expect(text).not.toMatch(/perdeu|perdido|falt|falhou/i);
  });
});

describe('retrato no fuso do aluno (D3)', () => {
  it('"hoje" é o dia local: em Manaus, 23h30 de terça ainda é terça', () => {
    // 2026-10-21T03:30Z = terça 23:30 em Manaus e quarta 00:30 em São Paulo.
    const now = new Date('2026-10-21T03:30:00.000Z');
    const base = {
      now,
      firstProtocolStart: new Date('2026-10-05T12:00:00.000Z'),
      mesocycleNumber: 1,
      currentWeek: 3,
      totalWeeks: 4,
      structure: {
        weeklyFrequency: 3,
        sessions: [
          { dayLabel: 'A', weekday: 'MON', focus: 'Costas' },
          { dayLabel: 'B', weekday: 'TUE', focus: 'Pernas' },
        ],
      } as never,
      completedDates: new Set<string>(),
      inProgressDates: new Set<string>(),
    };
    // Em Manaus "ontem" é segunda (19/10, treino A); em São Paulo já é terça (20/10, treino B).
    const manaus = buildRetrato({ ...base, timezone: 'America/Manaus' });
    const saoPaulo = buildRetrato({ ...base, timezone: 'America/Sao_Paulo' });
    expect(manaus.ultimasDuasSemanas.semRegistro.at(-1)).toContain('19/10');
    expect(saoPaulo.ultimasDuasSemanas.semRegistro.at(-1)).toContain('20/10');
  });
});

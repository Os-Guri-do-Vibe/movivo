import { describe, expect, it } from 'vitest';
import type { ProtocolStructure } from '@movivo/shared';

import { EXERCISE_BY_ID } from './exercise-catalog';
import {
  describeMeasurements,
  estimateSessionMinutes,
  measureProtocol,
  UNKNOWN_GROUP,
} from './protocol-measurements';

const catalog = { getById: (id: string) => EXERCISE_BY_ID.get(id) };

function ex(
  exerciseId: string,
  over: Partial<ProtocolStructure['sessions'][number]['exercises'][number]> = {},
) {
  return {
    exerciseId,
    name: exerciseId,
    sets: 3,
    reps: { min: 8, max: 12 },
    loadStrategy: 'DOUBLE_PROGRESSION' as const,
    restSeconds: 60,
    ...over,
  };
}

function protocol(sessions: ProtocolStructure['sessions']): ProtocolStructure {
  return {
    promptVersion: 't',
    goal: 'GAIN_MUSCLE',
    phase: 'HIPERTROFIA',
    phaseDurationWeeks: 4,
    weeklyFrequency: sessions.length,
    sessions,
  };
}

describe('measureProtocol — medições neutras, nunca regra', () => {
  const structure = protocol([
    {
      dayLabel: 'A',
      focus: 'Peito',
      weekday: 'MON',
      // peito, costas, peito: o peito VOLTA depois de outro grupo
      exercises: [
        ex('supino_reto_halter'),
        ex('puxada_alta_cabo'),
        ex('supino_inclinado_halter', { sets: 4 }),
      ],
    },
    {
      dayLabel: 'B',
      focus: 'Costas',
      weekday: 'THU',
      exercises: [ex('puxada_alta_cabo'), ex('remada_curvada_barra')],
    },
  ]);

  it('colapsa exercícios consecutivos do mesmo grupo e aponta quem volta na sessão', () => {
    const m = measureProtocol(structure, catalog);
    expect(m.sessions[0]?.groupSequence).toEqual(['peito', 'costas', 'peito']);
    expect(m.sessions[0]?.revisitedGroups).toEqual(['peito']);
    expect(m.sessions[1]?.groupSequence).toEqual(['costas']);
    expect(m.sessions[1]?.revisitedGroups).toEqual([]);
  });

  it('soma séries por grupo na semana e conta em quantas sessões o grupo aparece', () => {
    const m = measureProtocol(structure, catalog);
    expect(m.weeklySetsByGroup).toMatchObject({ peito: 7, costas: 9 });
    expect(m.weeklyFrequencyByGroup).toMatchObject({ peito: 1, costas: 2 });
  });

  it('ênfase: séries e frequência do grupo frente à média dos demais, sem acento/caixa', () => {
    const m = measureProtocol(structure, catalog, { emphasis: ['Costas'] });
    expect(m.emphasis).toEqual([{ group: 'Costas', weeklySets: 9, frequency: 2 }]);
    expect(m.nonEmphasisAverageSets).toBe(7);
  });

  it('exercício fora do catálogo aparece como grupo desconhecido, sem esconder', () => {
    const m = measureProtocol(
      protocol([{ dayLabel: 'A', focus: 'x', exercises: [ex('inventado_x')] }]),
      catalog,
    );
    expect(m.weeklySetsByGroup[UNKNOWN_GROUP]).toBe(3);
  });

  it('cardio não conta como série de musculação e entra no tempo por duração', () => {
    const session = {
      dayLabel: 'A',
      focus: 'x',
      exercises: [
        ex('supino_reto_halter'),
        ex('esteira', { sets: 1, reps: undefined, durationSeconds: 900, restSeconds: 0 }),
      ],
    } as unknown as ProtocolStructure['sessions'][number];
    const m = measureProtocol(protocol([session]), catalog);
    expect(Object.keys(m.weeklySetsByGroup)).not.toContain('sistema cardiovascular');
    expect(estimateSessionMinutes(session, catalog)).toBeGreaterThan(15);
  });

  it('compara o tempo estimado com o declarado e descreve em texto', () => {
    const m = measureProtocol(structure, catalog, { emphasis: ['costas'], sessionMinutes: 90 });
    expect(m.declaredSessionMinutes).toBe(90);
    const text = describeMeasurements(m);
    expect(text).toContain('peito: 7 séries em 1 sessão(ões)');
    expect(text).toContain('grupos em sequência = peito → costas → peito (volta a: peito)');
    expect(text).toContain('Ênfase "costas": 9 séries');
    expect(text).toContain('Tempo declarado pelo aluno: 90 min');
  });
});

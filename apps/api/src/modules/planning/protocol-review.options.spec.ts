/**
 * Opções do catálogo na edição do protocolo: além do nome e da medida, a tela recebe os grupos
 * musculares e o equipamento para filtrar a busca ao adicionar ou trocar exercício.
 */
import { protocolReviewSchema } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import { exerciseOptionsOf } from './protocol-review.service';

describe('exerciseOptionsOf', () => {
  const options = exerciseOptionsOf([
    {
      id: 'prancha',
      name: 'Prancha',
      measurement: 'DURATION',
      muscleGroups: ['core'],
      equipment: [],
    },
    {
      id: 'agachamento_livre',
      name: 'Agachamento livre',
      muscleGroups: ['quadríceps', 'glúteo'],
      equipment: ['barra'],
    },
  ]);

  it('ordena por nome e assume repetições quando a medida não vem do catálogo', () => {
    expect(options.map((o) => o.id)).toEqual(['agachamento_livre', 'prancha']);
    expect(options[0]).toEqual({
      id: 'agachamento_livre',
      name: 'Agachamento livre',
      measurement: 'REPS',
      muscleGroups: ['quadríceps', 'glúteo'],
      equipment: ['barra'],
    });
    expect(options[1]).toMatchObject({ measurement: 'DURATION', equipment: [] });
  });

  it('cabe no contrato da revisão (os campos novos são opcionais para quem lê o antigo)', () => {
    const base = {
      kind: 'TRAINING',
      planId: '22222222-2222-4222-8222-222222222222',
      version: 1,
      status: 'DRAFT',
      editable: true,
      strategy: null,
      startsOn: '2026-11-04',
      structure: {
        summary: 'Uma sessão.',
        modalityPriorities: [{ modality: 'STRENGTH', priority: 1 }],
        phases: [{ name: 'Base', focus: 'Técnica', weeks: 4, endsWithDeload: false }],
        sessions: [
          {
            key: 'STR_A',
            title: 'Força A',
            purpose: 'Base.',
            priority: 'KEY',
            weeklyFrequency: 1,
            estimatedMinutes: 40,
            estimatedRpe: 6,
            content: {
              modality: 'STRENGTH',
              focus: 'Corpo inteiro',
              exercises: [
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
        ],
      },
      weekPreview: { weekStart: '2026-11-02', startsOn: '2026-11-05', sessions: [], dropped: [] },
    };
    const parsed = protocolReviewSchema.parse({ ...base, exerciseOptions: options });
    expect(parsed.kind === 'TRAINING' && parsed.exerciseOptions[0]?.muscleGroups).toEqual([
      'quadríceps',
      'glúteo',
    ]);
    expect(() =>
      protocolReviewSchema.parse({
        ...base,
        exerciseOptions: [{ id: 'prancha', name: 'Prancha', measurement: 'DURATION' }],
      }),
    ).not.toThrow();
  });
});

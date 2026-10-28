import { describe, expect, it } from 'vitest';

import {
  dateLabel,
  durationLabel,
  enduranceLines,
  paceLabel,
  segmentLine,
  targetLabel,
} from './format';

describe('formatação do treino', () => {
  it('formata ritmo, alvo e duração', () => {
    expect(paceLabel(330)).toBe('5:30');
    expect(paceLabel(305)).toBe('5:05');
    expect(targetLabel({ by: 'ZONE', zone: 'Z2' })).toBe('zona 2');
    expect(targetLabel({ by: 'PACE', secondsPerKm: { min: 300, max: 315 } })).toBe(
      'ritmo 5:00–5:15 /km',
    );
    expect(targetLabel({ by: 'HEART_RATE', bpm: { min: 140, max: 150 } })).toBe('FC 140–150 bpm');
    expect(targetLabel({ by: 'RPE', rpe: { min: 3, max: 4 } })).toBe('esforço 3–4 de 10');
    expect(durationLabel(1_690)).toBe('28 min');
    expect(durationLabel(3_900)).toBe('1h05');
  });

  it('descreve trechos de corrida e blocos de HYROX', () => {
    expect(
      segmentLine({
        type: 'WORK',
        repeat: 5,
        distanceMeters: 800,
        target: { by: 'ZONE', zone: 'Z4' },
      }),
    ).toBe('Esforço: 5 × 800 m — zona 4');
    const running = enduranceLines({
      modality: 'RUNNING',
      kind: 'EASY',
      terrain: 'ANY',
      segments: [{ type: 'STEADY', distanceMeters: 5_000, target: { by: 'ZONE', zone: 'Z2' } }],
    });
    expect(running).toEqual(['Rodagem leve', 'Contínuo: 5 km — zona 2']);
    const hyrox = enduranceLines({
      modality: 'HYROX',
      kind: 'COMPROMISED_RUNNING',
      rounds: 2,
      blocks: [
        { type: 'RUN', distanceMeters: 1_000, target: { by: 'ZONE', zone: 'Z3' } },
        { type: 'STATION', station: 'SLED_PUSH', distanceMeters: 50, loadKg: 100 },
      ],
    });
    expect(hyrox).toEqual([
      '2 voltas do circuito',
      'Corrida 1 km — zona 3',
      'Sled push: 50 m com 100 kg',
    ]);
  });

  it('formata a data sem deslocar por fuso', () => {
    expect(dateLabel('2026-11-04')).toBe('qua 04/11');
  });
});

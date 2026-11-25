import {
  DEFAULT_ZONE_PACE_PCT_OF_5K,
  paceReferenceLabel,
  type PaceReference,
  type PlanSession,
  type TrainingPlanStructure,
} from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import {
  paceRangeOf,
  withPaceReferences,
  zoneOfRpe,
  type PaceReferenceContext,
} from './pace-reference';
import { zonePacePctOf5k } from './params';

/** 5 km em 25:00 = 5:00/km. */
const context = (over: Partial<PaceReferenceContext> = {}): PaceReferenceContext => ({
  recent5kSeconds: 1_500,
  zonePacePctOf5k: DEFAULT_ZONE_PACE_PCT_OF_5K,
  venues: { RUNNING: 'OUTDOOR', HYROX: 'HYROX_GYM' },
  ...over,
});

const session = (content: PlanSession['content']): PlanSession => ({
  key: 'S',
  title: 'Sessão',
  purpose: 'Teste.',
  priority: 'IMPORTANT',
  weeklyFrequency: 1,
  estimatedMinutes: 40,
  estimatedRpe: 5,
  content,
});

const plan = (...sessions: PlanSession[]): TrainingPlanStructure => ({
  summary: 'Plano.',
  modalityPriorities: [{ modality: 'RUNNING', priority: 1 }],
  phases: [{ name: 'Base', focus: 'Base.', weeks: 4, endsWithDeload: false }],
  sessions,
});

const running = (
  segments: Extract<PlanSession['content'], { modality: 'RUNNING' }>['segments'],
  over: Partial<Extract<PlanSession['content'], { modality: 'RUNNING' }>> = {},
) => session({ modality: 'RUNNING', kind: 'EASY', terrain: 'ANY', segments, ...over });

/** Rótulo da referência de um trecho (vazio se ele não tem). */
const labelOf = (item: { paceReference?: PaceReference } | undefined) =>
  item?.paceReference ? paceReferenceLabel(item.paceReference) : '';

const segmentsOf = (structure: TrainingPlanStructure) => {
  const content = structure.sessions[0]?.content;
  if (content?.modality !== 'RUNNING') throw new Error('fixture');
  return content.segments;
};

describe('ritmo de referência · cálculo', () => {
  it('cada zona vira uma faixa de ritmo a partir do 5 km do aluno', () => {
    const range = (zone: 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5') =>
      paceRangeOf({ by: 'ZONE', zone }, context());
    expect(range('Z1')).toEqual({ min: 405, max: 450 });
    expect(range('Z2')).toEqual({ min: 360, max: 405 });
    expect(range('Z3')).toEqual({ min: 330, max: 360 });
    expect(range('Z4')).toEqual({ min: 310, max: 330 });
    expect(range('Z5')).toEqual({ min: 285, max: 310 });
  });

  it('sem 5 km recente não há referência: nada é inventado', () => {
    expect(paceRangeOf({ by: 'ZONE', zone: 'Z2' }, context({ recent5kSeconds: null }))).toBeNull();
  });

  it('esforço percebido vira a zona correspondente; frequência cardíaca não tem referência', () => {
    expect(zoneOfRpe(2)).toBe('Z1');
    expect(zoneOfRpe(4)).toBe('Z2');
    expect(zoneOfRpe(6)).toBe('Z3');
    expect(zoneOfRpe(8)).toBe('Z4');
    expect(zoneOfRpe(9)).toBe('Z5');
    // Esforço 3 a 4 cobre Z1 e Z2: a faixa vai do mais rápido de Z2 ao mais lento de Z1.
    expect(paceRangeOf({ by: 'RPE', rpe: { min: 3, max: 4 } }, context())).toEqual({
      min: 360,
      max: 450,
    });
    expect(paceRangeOf({ by: 'HEART_RATE', bpm: { min: 130, max: 145 } }, context())).toBeNull();
  });

  it('os percentuais vêm da metodologia publicada; o que ela não trouxer usa o padrão', () => {
    const published = zonePacePctOf5k({
      zones: { zonePacePctOf5k: { Z2: { pct: { min: 125, max: 140 } } } },
    });
    expect(published.Z2).toEqual({ min: 125, max: 140 });
    expect(published.Z4).toEqual(DEFAULT_ZONE_PACE_PCT_OF_5K.Z4);
    expect(zonePacePctOf5k(undefined)).toEqual(DEFAULT_ZONE_PACE_PCT_OF_5K);
    expect(
      paceRangeOf({ by: 'ZONE', zone: 'Z2' }, context({ zonePacePctOf5k: published })),
    ).toEqual({ min: 375, max: 420 });
  });

  it('ritmo fora do que o plano aceita não vira referência', () => {
    // 5 km em 60:00 (12:00/km): Z1 passaria de 15:00/km.
    expect(paceRangeOf({ by: 'ZONE', zone: 'Z1' }, context({ recent5kSeconds: 3_600 }))).toBeNull();
  });
});

describe('ritmo de referência · no plano', () => {
  it('a zona continua sendo o alvo; a referência traz ritmo e velocidade', () => {
    const [warmup, steady] = segmentsOf(
      withPaceReferences(
        plan(
          running([
            { type: 'WARMUP', durationSeconds: 600, target: { by: 'ZONE', zone: 'Z1' } },
            { type: 'STEADY', durationSeconds: 1_800, target: { by: 'ZONE', zone: 'Z2' } },
          ]),
        ),
        context(),
      ),
    );
    expect(steady?.target).toEqual({ by: 'ZONE', zone: 'Z2' });
    expect(steady?.paceReference).toEqual({
      secondsPerKm: { min: 360, max: 405 },
      treadmill: false,
    });
    expect(labelOf(steady)).toBe('6:00–6:45/km · esteira 8,9–10,0 km/h');
    expect(labelOf(warmup)).toBe('6:45–7:30/km · esteira 8,0–8,9 km/h');
  });

  it('marca quando o treino foi planejado para a esteira (terreno ou academia)', () => {
    const segments = [
      {
        type: 'STEADY' as const,
        durationSeconds: 1_800,
        target: { by: 'ZONE' as const, zone: 'Z2' as const },
      },
    ];
    const byTerrain = segmentsOf(
      withPaceReferences(plan(running(segments, { terrain: 'TREADMILL' })), context()),
    )[0];
    expect(byTerrain?.paceReference?.treadmill).toBe(true);
    expect(labelOf(byTerrain)).toBe('6:00–6:45/km · esteira 8,9–10,0 km/h');
    const byVenue = segmentsOf(
      withPaceReferences(
        plan(running(segments)),
        context({ venues: { RUNNING: 'FULL_GYM', HYROX: 'HYROX_GYM' } }),
      ),
    )[0];
    expect(byVenue?.paceReference?.treadmill).toBe(true);
    // Pista é rua, mesmo para quem treina em academia.
    const track = segmentsOf(
      withPaceReferences(
        plan(running(segments, { terrain: 'TRACK' })),
        context({ venues: { RUNNING: 'FULL_GYM' } }),
      ),
    )[0];
    expect(track?.paceReference?.treadmill).toBe(false);
  });

  it('alvo que já é ritmo também leva a referência: dela sai a velocidade para a esteira', () => {
    const pace = { by: 'PACE' as const, secondsPerKm: { min: 300, max: 315 } };
    const segments = [{ type: 'WORK' as const, distanceMeters: 1_000, target: pace }];
    const outdoor = segmentsOf(withPaceReferences(plan(running(segments)), context()))[0];
    expect(outdoor?.paceReference).toEqual({ secondsPerKm: pace.secondsPerKm, treadmill: false });
    expect(labelOf(outdoor)).toBe('5:00–5:15/km · esteira 11,4–12,0 km/h');
    // O ritmo do alvo vale mesmo sem 5 km informado.
    const noAnchor = segmentsOf(
      withPaceReferences(plan(running(segments)), context({ recent5kSeconds: null })),
    )[0];
    expect(noAnchor?.paceReference?.secondsPerKm).toEqual(pace.secondsPerKm);
  });

  it('subida, trilha, areia e tiros de aceleração ficam sem referência', () => {
    const zone = { by: 'ZONE' as const, zone: 'Z4' as const };
    const work = [{ type: 'WORK' as const, durationSeconds: 60, target: zone }];
    for (const over of [
      { kind: 'HILLS' as const },
      { terrain: 'TRAIL' as const },
      { terrain: 'SAND' as const },
    ]) {
      expect(
        segmentsOf(withPaceReferences(plan(running(work, over)), context()))[0],
      ).not.toHaveProperty('paceReference');
    }
    expect(
      segmentsOf(
        withPaceReferences(
          plan(running([{ type: 'STRIDES', repeat: 4, durationSeconds: 20, target: zone }])),
          context(),
        ),
      )[0],
    ).not.toHaveProperty('paceReference');
  });

  it('o que o agente mandar no campo é descartado: a referência é sempre do código', () => {
    const invented = { secondsPerKm: { min: 200, max: 210 }, treadmill: false };
    const zone = { by: 'ZONE' as const, zone: 'Z2' as const };
    const withAnchor = segmentsOf(
      withPaceReferences(
        plan(
          running([
            { type: 'STEADY', durationSeconds: 600, target: zone, paceReference: invented },
          ]),
        ),
        context(),
      ),
    )[0];
    expect(withAnchor?.paceReference?.secondsPerKm).toEqual({ min: 360, max: 405 });
    const withoutAnchor = segmentsOf(
      withPaceReferences(
        plan(
          running([
            { type: 'STEADY', durationSeconds: 600, target: zone, paceReference: invented },
          ]),
        ),
        context({ recent5kSeconds: null }),
      ),
    )[0];
    expect(withoutAnchor).not.toHaveProperty('paceReference');
  });

  it('as corridas do HYROX também ganham referência; estações e pausas não', () => {
    const structure = withPaceReferences(
      plan(
        session({
          modality: 'HYROX',
          kind: 'COMPROMISED_RUNNING',
          rounds: 2,
          blocks: [
            { type: 'RUN', distanceMeters: 1_000, target: { by: 'ZONE', zone: 'Z3' } },
            { type: 'STATION', station: 'SLED_PUSH', distanceMeters: 50, loadKg: 102 },
            { type: 'REST', durationSeconds: 60 },
          ],
        }),
      ),
      context(),
    );
    const content = structure.sessions[0]?.content;
    if (content?.modality !== 'HYROX') throw new Error('fixture');
    const [run, station, rest] = content.blocks;
    expect(run).toMatchObject({
      paceReference: { secondsPerKm: { min: 330, max: 360 }, treadmill: true },
    });
    expect(station).not.toHaveProperty('paceReference');
    expect(rest).not.toHaveProperty('paceReference');
    // HYROX feito em casa ou na rua: ritmo, não esteira.
    const outdoor = withPaceReferences(structure, context({ venues: { HYROX: 'HOME' } }));
    const outdoorContent = outdoor.sessions[0]?.content;
    if (outdoorContent?.modality !== 'HYROX') throw new Error('fixture');
    expect(outdoorContent.blocks[0]).toMatchObject({ paceReference: { treadmill: false } });
  });

  it('musculação e esporte externo passam intactos', () => {
    const strength = session({
      modality: 'STRENGTH',
      focus: 'Corpo inteiro',
      exercises: [
        {
          exerciseId: 'a',
          name: 'Agachamento',
          sets: 3,
          reps: { min: 8, max: 10 },
          loadStrategy: 'RIR',
          rir: 2,
          restSeconds: 90,
        },
      ],
    });
    expect(withPaceReferences(plan(strength), context()).sessions[0]).toEqual(strength);
  });
});

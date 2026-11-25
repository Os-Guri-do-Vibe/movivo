import {
  formatShareCardClock,
  shareCardDataOf,
  shareCardLayoutsFor,
  splitsOf,
  type ShareCardData,
  type SessionContent,
} from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import { loadShareCardAssets } from './share-card.assets';
import { ShareCardRenderer } from './share-card-renderer.service';
import { buildShareCardSvg, clip, inlineUnit, statsOf } from './share-card.svg';

const STRENGTH: ShareCardData = {
  modality: 'STRENGTH',
  title: 'Treino A · Peito e tríceps',
  durationSeconds: 3_120,
  exercises: 5,
  sets: 18,
  volumeKg: 12_340,
  rpe: 8,
  body: 'male',
  muscles: ['chest', 'triceps', 'shoulders'],
};
const RUNNING: ShareCardData = {
  modality: 'RUNNING',
  title: 'Rodagem leve',
  durationSeconds: 1_694,
  distanceMeters: 5_020,
  avgPaceSecondsPerKm: 337,
  avgHeartRate: 148,
  elevationGainMeters: 42,
  splits: [342, 338, 335, 331, 329],
  rpe: 5,
  treadmill: false,
};
const HYROX: ShareCardData = {
  modality: 'HYROX',
  title: 'Simulado HYROX',
  durationSeconds: 5_430,
  runDistanceMeters: 8_000,
  rounds: 1,
  stations: [
    { station: 'SKIERG', seconds: 290 },
    { station: 'SLED_PUSH', seconds: 210 },
    { station: 'WALL_BALLS', seconds: null },
  ],
  rpe: 9,
};
const EXTERNAL: ShareCardData = {
  modality: 'EXTERNAL_SPORT',
  title: 'Beach tennis',
  sport: 'Beach tennis',
  durationSeconds: 5_400,
  rpe: 6,
};

describe('cartão de compartilhamento · modelos por modalidade', () => {
  it('cada modalidade oferece os modelos que fazem sentido para ela', () => {
    // O clássico (cartão de sempre) abre o carrossel; o específico da modalidade vem em seguida.
    expect(shareCardLayoutsFor(STRENGTH)).toEqual(['CLASSIC', 'MUSCLES', 'SUMMARY', 'HIGHLIGHT']);
    expect(shareCardLayoutsFor(RUNNING)).toEqual(['CLASSIC', 'SPLITS', 'SUMMARY', 'HIGHLIGHT']);
    expect(shareCardLayoutsFor(HYROX)).toEqual(['CLASSIC', 'STATIONS', 'SUMMARY', 'HIGHLIGHT']);
    expect(shareCardLayoutsFor(EXTERNAL)).toEqual(['CLASSIC', 'SUMMARY', 'HIGHLIGHT']);
  });

  it('sem o dado que o modelo pede, ele não é oferecido', () => {
    expect(shareCardLayoutsFor({ ...STRENGTH, body: null })).not.toContain('MUSCLES');
    expect(shareCardLayoutsFor({ ...STRENGTH, muscles: [] })).not.toContain('MUSCLES');
    expect(shareCardLayoutsFor({ ...RUNNING, splits: [340] })).not.toContain('SPLITS');
    expect(shareCardLayoutsFor({ ...HYROX, stations: [] })).not.toContain('STATIONS');
  });

  it('os números saem do registro, com unidade e sem campos vazios', () => {
    expect(statsOf(RUNNING).slice(0, 3)).toEqual([
      { label: 'DISTÂNCIA', value: '5,02', unit: 'km' },
      { label: 'RITMO MÉDIO', value: '5:37', unit: '/km' },
      { label: 'TEMPO', value: '28:14', unit: null },
    ]);
    expect(statsOf(STRENGTH)[1]).toEqual({ label: 'VOLUME', value: '12.340', unit: 'kg' });
    // Só peso do corpo: sem "volume 0 kg" no cartão.
    expect(statsOf({ ...STRENGTH, volumeKg: 0 }).map((s) => s.label)).not.toContain('VOLUME');
    expect(statsOf({ ...EXTERNAL, rpe: null }).map((s) => s.label)).toEqual(['TEMPO']);
  });

  it('na linha corrida, número sem unidade leva o rótulo', () => {
    expect(inlineUnit({ label: 'SÉRIES', value: '18', unit: null })).toBe('séries');
    expect(inlineUnit({ label: 'TEMPO', value: '52:00', unit: null })).toBe('de treino');
    expect(inlineUnit({ label: 'RITMO MÉDIO', value: '5:37', unit: '/km' })).toBe('/km');
  });

  it('texto longo é cortado e escapado (nunca vaza da área nem quebra o SVG)', () => {
    expect(clip('Treino <A> & "B"', 40)).toBe('Treino &#60;A&#62; &#38; &#34;B&#34;');
    expect(clip('x'.repeat(50), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});

describe('cartão de compartilhamento · desenho', () => {
  const assets = loadShareCardAssets();
  const all: ShareCardData[] = [
    STRENGTH,
    { ...STRENGTH, body: 'female' },
    RUNNING,
    HYROX,
    EXTERNAL,
  ];

  it('todo modelo de toda modalidade gera um SVG válido, sempre com fundo transparente', () => {
    for (const data of all) {
      for (const layout of shareCardLayoutsFor(data)) {
        const svg = buildShareCardSvg(assets, { data, layout });
        expect(svg, `${data.modality}/${layout}`).toMatch(/^<svg[\s\S]*<\/svg>$/);
        // As imagens embutidas (base64) ficam de fora: "null" pode aparecer nos bytes.
        expect(svg.replace(/data:[^"]+/g, '')).not.toMatch(/undefined|NaN|null/);
        // Nada pinta a tela inteira: o PNG sai transparente para colar sobre a foto.
        expect(svg).not.toContain('width="1080" height="1920" fill=');
      }
    }
  });

  it('o clássico é o cartão da versão anterior: silhuetas, selo, tempo h:m:s e o slogan', () => {
    const strength = buildShareCardSvg(assets, { data: STRENGTH, layout: 'CLASSIC' });
    expect(strength).toContain('MÚSCULOS TRABALHADOS');
    expect(strength).toContain('TREINO CONCLUÍDO');
    expect(strength).toContain('MOVE YOUR POTENTIAL.');
    expect(strength).toContain(formatShareCardClock(3_120));
    expect(formatShareCardClock(3_909)).toBe('01:05:09');
    // Silhueta feminina leva o cabelo desenhado; a masculina não.
    expect(strength).not.toContain('hair-front');
    expect(
      buildShareCardSvg(assets, { data: { ...STRENGTH, body: 'female' }, layout: 'CLASSIC' }),
    ).toContain('hair-front');
    // Fora da musculação, os números ocupam o lugar das silhuetas.
    const running = buildShareCardSvg(assets, { data: RUNNING, layout: 'CLASSIC' });
    expect(running).not.toContain('MÚSCULOS TRABALHADOS');
    expect(running).toContain('DISTÂNCIA');
    expect(running).toContain('5,02');
    expect(buildShareCardSvg(assets, { data: EXTERNAL, layout: 'CLASSIC' })).toContain(
      'Beach tennis',
    );
  });

  it('desenha o PNG 1080×1920 e reaproveita o mesmo cartão', async () => {
    const renderer = new ShareCardRenderer();
    const first = await renderer.render({ data: RUNNING, layout: 'SPLITS' });
    expect(first.png.subarray(1, 4).toString()).toBe('PNG');
    expect(first.png.readUInt32BE(16)).toBe(1080);
    expect(first.png.readUInt32BE(20)).toBe(1920);
    const again = await renderer.render({ data: RUNNING, layout: 'SPLITS' });
    expect(again).toBe(first);
  }, 30_000);
});

describe('cartão de compartilhamento · dados do treino gravado', () => {
  const base = {
    title: 'Treino',
    content: null,
    rpe: 7,
    durationMinutes: 50,
    sets: [],
    metrics: null,
    biologicalSex: 'FEMALE',
    muscleGroupsOf: (id: string) =>
      ({
        supino: ['peito', 'tríceps'],
        agachamento: ['quadríceps', 'glúteo'],
        burpee: ['corpo todo'],
      })[id] ?? [],
  };

  it('musculação: só séries feitas contam (volume, séries, exercícios e músculos)', () => {
    const data = shareCardDataOf({
      ...base,
      modality: 'STRENGTH',
      sets: [
        { exerciseId: 'supino', setNumber: 1, reps: 10, loadKg: 40, completed: true },
        { exerciseId: 'supino', setNumber: 2, reps: 8, loadKg: 40, completed: true },
        // Aquecimento e série não feita não entram.
        { exerciseId: 'supino', setNumber: 0, reps: 15, loadKg: 20, completed: true },
        { exerciseId: 'agachamento', setNumber: 1, reps: 10, loadKg: 60, completed: false },
        { exerciseId: 'burpee', setNumber: 1, reps: 10, loadKg: null, completed: true },
      ],
    });
    expect(data).toMatchObject({
      modality: 'STRENGTH',
      sets: 3,
      exercises: 2,
      volumeKg: 720,
      durationSeconds: 3_000,
      body: 'female',
    });
    // "Corpo todo" do burpee não pinta o corpo inteiro quando há músculo específico.
    expect(data.modality === 'STRENGTH' && data.muscles.sort()).toEqual(['chest', 'triceps']);
  });

  it('sem sexo no cadastro, a silhueta não é presumida', () => {
    const data = shareCardDataOf({ ...base, modality: 'STRENGTH', biologicalSex: null });
    expect(data.modality === 'STRENGTH' && data.body).toBeNull();
  });

  it('corrida: números do relógio, ritmo calculado quando falta e parciais de ~1 km', () => {
    const content: SessionContent = {
      modality: 'RUNNING',
      kind: 'EASY',
      terrain: 'TREADMILL',
      segments: [{ type: 'STEADY', durationSeconds: 1_800, target: { by: 'ZONE', zone: 'Z2' } }],
    };
    const data = shareCardDataOf({
      ...base,
      modality: 'RUNNING',
      content,
      metrics: {
        distanceMeters: 5_000,
        movingSeconds: 1_500,
        laps: [
          { distanceMeters: 1_000, durationSeconds: 305 },
          { distanceMeters: 1_000, durationSeconds: 298 },
          { distanceMeters: 400, durationSeconds: 120 },
        ],
      },
    });
    expect(data).toMatchObject({
      modality: 'RUNNING',
      distanceMeters: 5_000,
      avgPaceSecondsPerKm: 300,
      durationSeconds: 1_500,
      splits: [305, 298],
      treadmill: true,
    });
    expect(splitsOf(null)).toEqual([]);
  });

  it('HYROX: estações do relógio quando há, senão as do circuito, e a corrida planejada', () => {
    const content: SessionContent = {
      modality: 'HYROX',
      kind: 'SIMULATION',
      rounds: 2,
      blocks: [
        { type: 'RUN', distanceMeters: 1_000, target: { by: 'ZONE', zone: 'Z3' } },
        { type: 'STATION', station: 'SLED_PUSH', distanceMeters: 50, loadKg: 102 },
      ],
    };
    const planned = shareCardDataOf({ ...base, modality: 'HYROX', content });
    expect(planned).toMatchObject({
      runDistanceMeters: 2_000,
      rounds: 2,
      stations: [{ station: 'SLED_PUSH', seconds: null }],
    });
    const timed = shareCardDataOf({
      ...base,
      modality: 'HYROX',
      content,
      metrics: { stations: [{ station: 'SKIERG', durationSeconds: 291.6 }] },
    });
    expect(timed.modality === 'HYROX' && timed.stations).toEqual([
      { station: 'SKIERG', seconds: 292 },
    ]);
  });

  it('esporte externo usa o nome do esporte', () => {
    const data = shareCardDataOf({
      ...base,
      modality: 'EXTERNAL_SPORT',
      content: {
        modality: 'EXTERNAL_SPORT',
        sport: 'OTHER',
        label: 'Beach tennis',
        plannedMinutes: 90,
        plannedRpe: 6,
      },
    });
    expect(data).toMatchObject({ sport: 'Beach tennis', durationSeconds: 3_000 });
  });
});

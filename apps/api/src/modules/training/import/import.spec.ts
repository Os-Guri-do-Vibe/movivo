import { describe, expect, it } from 'vitest';

import { at } from '../../planning/calc/util';
import { FitParseError, parseFit } from './fit-parser';
import { buildFit } from './fit-fixture';
import { GpxParseError, parseGpx } from './gpx-parser';

describe('parseFit', () => {
  it('lê o resumo e as voltas', () => {
    const { metrics, sport } = parseFit(buildFit());
    expect(sport).toBe('RUNNING');
    expect(metrics.distanceMeters).toBe(5_000);
    expect(metrics.movingSeconds).toBe(1_690);
    expect(metrics.elapsedSeconds).toBe(1_700);
    expect(metrics.avgHeartRate).toBe(152);
    expect(metrics.maxHeartRate).toBe(171);
    expect(metrics.elevationGainMeters).toBe(42);
    expect(metrics.cadenceSpm).toBe(176);
    expect(metrics.avgPaceSecondsPerKm).toBe(338);
    expect(metrics.laps).toEqual([
      { distanceMeters: 5_000, durationSeconds: 1_500, avgHeartRate: 150 },
    ]);
  });

  it('recusa CRC errado, arquivo truncado, falso FIT e arquivo sem resumo', () => {
    expect(() => parseFit(buildFit({ corrupt: true }))).toThrow(FitParseError);
    expect(() => parseFit(buildFit().slice(0, 30))).toThrow(FitParseError);
    expect(() =>
      parseFit(new TextEncoder().encode('isto não é um arquivo fit de verdade')),
    ).toThrow(FitParseError);
    expect(() => parseFit(buildFit({ withoutSession: true }))).toThrow(/resumo/);
  });

  it('recusa arquivo maior que o limite', () => {
    expect(() => parseFit(new Uint8Array(9 * 1024 * 1024))).toThrow(/limite/);
  });
});

function gpx(points: { lat: number; lon: number; ele: number; t: string; hr?: number }[]) {
  const trkpts = points
    .map(
      (p) =>
        `<trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.ele}</ele><time>${p.t}</time>${
          p.hr
            ? `<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>${p.hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`
            : ''
        }</trkpt>`,
    )
    .join('');
  return `<?xml version="1.0"?><gpx version="1.1" creator="teste"><trk><trkseg>${trkpts}</trkseg></trk></gpx>`;
}

describe('parseGpx', () => {
  // ~0,001° de latitude ≈ 111 m.
  const track = [0, 1, 2, 3, 4].map((i) => ({
    lat: -23.5 + i * 0.001,
    lon: -46.6,
    ele: 760 + i * 4,
    t: new Date(Date.UTC(2026, 10, 1, 8, 0, i * 30)).toISOString(),
    hr: 140 + i * 5,
  }));

  it('calcula distância, tempo, subida e FC média', () => {
    const { metrics } = parseGpx(gpx(track));
    expect(metrics.distanceMeters).toBeGreaterThan(430);
    expect(metrics.distanceMeters).toBeLessThan(460);
    expect(metrics.elapsedSeconds).toBe(120);
    expect(metrics.movingSeconds).toBe(120);
    expect(metrics.elevationGainMeters).toBe(16);
    expect(metrics.avgHeartRate).toBe(150);
    expect(metrics.maxHeartRate).toBe(160);
    expect(metrics.avgPaceSecondsPerKm).toBeGreaterThan(200);
  });

  it('pausa longa não entra no tempo em movimento', () => {
    const paused = [
      ...track.slice(0, 3),
      { ...at(track, 3), t: '2026-11-01T08:30:00.000Z' },
      { ...at(track, 4), t: '2026-11-01T08:30:30Z' },
    ];
    const { metrics } = parseGpx(gpx(paused));
    expect(metrics.movingSeconds).toBe(90);
    expect(metrics.elapsedSeconds).toBe(1_830);
  });

  it('recusa DOCTYPE/ENTITY, arquivo que não é GPX e trilha vazia', () => {
    expect(() => parseGpx('<!DOCTYPE x [<!ENTITY a "b">]><gpx></gpx>')).toThrow(GpxParseError);
    expect(() => parseGpx('<html></html>')).toThrow(/não é um arquivo GPX/);
    expect(() => parseGpx('<gpx version="1.1"></gpx>')).toThrow(/trilha/);
  });

  it('ignora ponto com coordenada fora do intervalo', () => {
    const bad = gpx([...track, { lat: 999, lon: 0, ele: 0, t: '2026-11-01T08:10:00Z' }]);
    expect(parseGpx(bad).metrics.distanceMeters).toBeLessThan(460);
  });
});

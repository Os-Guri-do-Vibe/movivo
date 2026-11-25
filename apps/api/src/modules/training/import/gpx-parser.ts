/**
 * Leitor de `.gpx`: distância (haversine), tempo, ganho de elevação e FC média a partir dos
 * pontos da trilha. Sem biblioteca de XML: o arquivo vem do aluno, então a leitura é por padrão
 * restrito e recusa DOCTYPE/ENTITY (expansão de entidade) e arquivos grandes demais.
 */
import { finalizeMetrics, type ParsedActivity } from './metrics';

export class GpxParseError extends Error {}

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_POINTS = 200_000;
const EARTH_RADIUS_M = 6_371_000;
/** Variação de elevação menor que isto é ruído de GPS e não conta como subida. */
const ELEVATION_NOISE_M = 3;
/** Pausas longas entre pontos não entram no tempo em movimento. */
const MAX_GAP_SECONDS = 60;

interface Point {
  lat: number;
  lon: number;
  ele: number | null;
  time: number | null;
  hr: number | null;
}

function haversine(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function tag(block: string, name: string): string | null {
  const match = new RegExp(`<(?:[\\w-]+:)?${name}>\\s*([^<]+?)\\s*</(?:[\\w-]+:)?${name}>`).exec(
    block,
  );
  return match?.[1] ?? null;
}

export function parseGpx(text: string): ParsedActivity {
  if (text.length > MAX_BYTES) throw new GpxParseError('arquivo maior que o limite de 10 MB');
  if (/<!DOCTYPE|<!ENTITY/i.test(text))
    throw new GpxParseError('GPX com DOCTYPE/ENTITY não é aceito');
  if (!/<gpx[\s>]/i.test(text)) throw new GpxParseError('não é um arquivo GPX');

  const points: Point[] = [];
  for (const match of text.matchAll(/<trkpt\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/g)) {
    if (points.length >= MAX_POINTS) throw new GpxParseError('pontos demais no arquivo');
    const attrs = match[1] ?? '';
    const lat = Number(/lat="([^"]+)"/.exec(attrs)?.[1]);
    const lon = Number(/lon="([^"]+)"/.exec(attrs)?.[1]);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    ) {
      continue;
    }
    const body = match[2] ?? '';
    const ele = Number(tag(body, 'ele'));
    const time = Date.parse(tag(body, 'time') ?? '');
    const hr = Number(tag(body, 'hr'));
    points.push({
      lat,
      lon,
      ele: Number.isFinite(ele) ? ele : null,
      time: Number.isFinite(time) ? time : null,
      hr: Number.isFinite(hr) && hr >= 30 && hr <= 240 ? hr : null,
    });
  }
  if (points.length < 2) throw new GpxParseError('o arquivo não tem uma trilha com pontos');

  let meters = 0;
  let moving = 0;
  let gain = 0;
  let lastEle = points[0]?.ele ?? null;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    meters += haversine(a, b);
    if (a.time !== null && b.time !== null) {
      const gap = (b.time - a.time) / 1000;
      if (gap > 0 && gap <= MAX_GAP_SECONDS) moving += gap;
    }
    if (b.ele !== null && lastEle !== null && b.ele - lastEle >= ELEVATION_NOISE_M) {
      gain += b.ele - lastEle;
      lastEle = b.ele;
    } else if (b.ele !== null && lastEle !== null && lastEle - b.ele >= ELEVATION_NOISE_M) {
      lastEle = b.ele;
    } else if (lastEle === null) {
      lastEle = b.ele;
    }
  }
  const times = points.map((p) => p.time).filter((t): t is number => t !== null);
  const elapsed = times.length >= 2 ? (Math.max(...times) - Math.min(...times)) / 1000 : undefined;
  const heartRates = points.map((p) => p.hr).filter((h): h is number => h !== null);
  const avgHeartRate = heartRates.length
    ? Math.round(heartRates.reduce((s, h) => s + h, 0) / heartRates.length)
    : undefined;

  return finalizeMetrics(
    {
      distanceMeters: Math.round(meters),
      movingSeconds: moving > 0 ? Math.round(moving) : undefined,
      elapsedSeconds: elapsed !== undefined ? Math.round(elapsed) : undefined,
      avgHeartRate,
      maxHeartRate: heartRates.length ? Math.max(...heartRates) : undefined,
      elevationGainMeters: Math.round(gain),
    },
    { sport: 'OTHER' },
  );
}

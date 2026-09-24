/**
 * Constelação do MOVIVO CLUB em coordenadas normalizadas (-1..1), determinística: a
 * mesma na cena WebGL e no fallback estático em SVG. Sem Three.js aqui — o servidor
 * também usa este módulo para desenhar o fallback.
 */
import { seededRandom } from './webgl';

export interface ClubPoint {
  x: number;
  y: number;
  z: number;
  /** Momento (0–1 do progresso) em que o ponto "nasce". */
  birth: number;
  /** Marcos (milestones): pontos um pouco maiores e mais brilhantes. */
  milestone: boolean;
}

export interface ClubLayout {
  points: ClubPoint[];
  links: [number, number][];
}

function gaussian(random: () => number): number {
  // Box–Muller simplificado; suficiente para agrupar pontos em torno de um centro.
  const u = Math.max(random(), 1e-6);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function buildClubLayout(count: number, seed = 1709): ClubLayout {
  const random = seededRandom(seed);
  const clusters = Array.from({ length: 7 }, (_, index) => ({
    x: -0.82 + (index / 6) * 1.64 + (random() - 0.5) * 0.18,
    y: (random() - 0.5) * 1.1,
  }));

  const points: ClubPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const free = random() < 0.16;
    const cluster = clusters[i % clusters.length] ?? { x: 0, y: 0 };
    const x = free ? random() * 2 - 1 : cluster.x + gaussian(random) * 0.13;
    const y = free ? random() * 2 - 1 : cluster.y + gaussian(random) * 0.16;
    points.push({
      x: Math.max(-1, Math.min(1, x)),
      y: Math.max(-1, Math.min(1, y)),
      z: (random() - 0.5) * 2,
      birth: Math.pow(random(), 1.3) * 0.6,
      milestone: random() < 0.05,
    });
  }

  // Cada ponto se liga a até 2 vizinhos próximos (sem duplicar pares).
  const links: [number, number][] = [];
  const seen = new Set<string>();
  const maxDistance = 0.19;
  points.forEach((point, index) => {
    const nearest = points
      .map((other, otherIndex) => ({
        otherIndex,
        distance: Math.hypot(point.x - other.x, (point.y - other.y) * 0.8),
      }))
      .filter(({ otherIndex, distance }) => otherIndex !== index && distance < maxDistance)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 2);
    for (const { otherIndex } of nearest) {
      const key = index < otherIndex ? `${index}-${otherIndex}` : `${otherIndex}-${index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push([index, otherIndex]);
    }
  });

  return { points, links };
}

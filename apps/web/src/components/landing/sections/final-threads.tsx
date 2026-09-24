'use client';

import { SceneCanvas } from '../scenes/scene-canvas';

import styles from './final-cta.module.css';

const loadWebThreads = () =>
  import('../scenes/web-threads-scene').then((mod) => mod.createWebThreadsScene);

/*
 * Fallback: os mesmos seis fios do shader congelados no instante zero (mesma fórmula e
 * parâmetros de `web-threads-scene.ts`), em coordenadas 0–1000. Antes do WebGL, com
 * movimento reduzido ou sem WebGL, o desenho já está no lugar e a troca não pula.
 */
const THREADS = 6;
const THREAD_PATHS = Array.from({ length: THREADS }, (_, i) => {
  const shimmer = Math.sin(i * 1.3) * 0.35;
  const points: string[] = [];
  for (let step = 0; step <= 120; step += 1) {
    const x = step / 120;
    const mirror = Math.sign(0.5 - x);
    const phase = ((i * 2 * Math.PI) / THREADS) * mirror + shimmer;
    const amplitude = 0.18 * Math.abs(x - 0.5) * (1 + i);
    const y = 0.5 - Math.sin(x * 5 + phase) * amplitude;
    points.push(`${(x * 1000).toFixed(1)} ${((1 - y) * 1000).toFixed(1)}`);
  }
  return `M${points.join(' L')}`;
});

function ThreadsStill() {
  return (
    <svg
      className={styles.threadsStill}
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      focusable="false"
    >
      {THREAD_PATHS.map((d) => (
        <g key={d}>
          <path d={d} className={styles.threadHalo} />
          <path d={d} className={styles.thread} />
        </g>
      ))}
    </svg>
  );
}

/** Fundo do CTA final: fios de luz Verde Pulso que se abrem a partir do centro. */
export function FinalThreads() {
  return (
    <div className={styles.threads} aria-hidden="true">
      <SceneCanvas load={loadWebThreads} fallback={<ThreadsStill />} />
    </div>
  );
}

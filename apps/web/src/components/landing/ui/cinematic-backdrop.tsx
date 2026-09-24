import { cn } from '@/lib/utils';

import styles from './cinematic-backdrop.module.css';

/*
 * Fallback cinematográfico do Hero enquanto o filme não existe (a variante `final` ficou sem
 * uso: o CTA final passou a usar o fundo Web Threads).
 *
 * Arquitetura modernista brasileira abstrata — laje curva sobre pilotis, rampa que
 * sobe — desenhada só com vetores de baixíssimo contraste. O único elemento vivo é o
 * Pulse: um rastro de luz percorrendo a laje, a mesma leitura do filme ("pessoa em
 * movimento dentro do ambiente"). Nada aqui se lê como "placeholder".
 */
const SLAB_TOP = 'M-80 610 C 260 520 620 470 960 500 C 1240 525 1460 600 1700 560';
const SLAB_BOTTOM = 'M-80 648 C 260 560 620 512 960 542 C 1240 566 1460 640 1700 600';
const SLAB_FILL = `${SLAB_TOP} L1700 600 C 1460 640 1240 566 960 542 C 620 512 260 560 -80 648 Z`;
const RAMP = 'M1010 842 L1420 640';
const RAMP_EDGE = 'M1050 870 L1460 668';
const PILOTIS = [120, 300, 470, 640, 800, 1150, 1330];

function slabY(x: number): number {
  // Aproximação suficiente para ancorar os pilotis sob a curva da laje.
  const t = (x + 80) / 1780;
  return 645 - Math.sin(t * Math.PI) * 120 + t * 20;
}

export function CinematicBackdrop({
  variant = 'hero',
  className,
}: {
  variant?: 'hero' | 'final';
  className?: string;
}) {
  const id = `mv-backdrop-${variant}`;
  return (
    <div className={cn(styles.backdrop, styles[variant], className)} aria-hidden="true">
      <div className={styles.light} />
      <svg
        className={styles.architecture}
        viewBox="0 0 1600 1000"
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
      >
        <defs>
          <linearGradient id={`${id}-slab`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#06302a" stopOpacity="0" />
            <stop offset="0.45" stopColor="#0b3a32" stopOpacity="0.85" />
            <stop offset="1" stopColor="#06302a" stopOpacity="0.2" />
          </linearGradient>
          <linearGradient id={`${id}-pilotis`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f4f7f3" stopOpacity="0.12" />
            <stop offset="1" stopColor="#f4f7f3" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${id}-floor`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0a2621" stopOpacity="0.9" />
            <stop offset="1" stopColor="#03110e" stopOpacity="0" />
          </linearGradient>
        </defs>

        <rect x="0" y="840" width="1600" height="160" fill={`url(#${id}-floor)`} />
        <path d="M0 840 H1600" className={styles.horizon} />

        {PILOTIS.map((x) => (
          <rect
            key={x}
            x={x}
            y={slabY(x)}
            width="3"
            height={840 - slabY(x)}
            fill={`url(#${id}-pilotis)`}
          />
        ))}

        <path d={SLAB_FILL} fill={`url(#${id}-slab)`} />
        <path d={SLAB_TOP} className={styles.edge} />
        <path d={SLAB_BOTTOM} className={styles.edgeSoft} />

        <path d={RAMP} className={styles.edge} />
        <path d={RAMP_EDGE} className={styles.edgeSoft} />

        {/* Pulse: rastro + halo largo e translúcido (sem filtro de blur, barato de pintar). */}
        <path d={SLAB_TOP} className={styles.trailHalo} pathLength={1000} />
        <path d={SLAB_TOP} className={styles.trail} pathLength={1000} />
      </svg>
      <div className={styles.grain} />
    </div>
  );
}

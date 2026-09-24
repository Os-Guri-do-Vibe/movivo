import { cn } from '@/lib/utils';

import styles from './how-it-works.module.css';

/*
 * Um visual por ato, todos com a mesma gramática: traço fino petróleo sobre Névoa e o
 * Pulse como único acento. A animação só acontece no ato ativo (`[data-active]`).
 * Sem `id` interno: o mesmo visual aparece duas vezes (palco desktop e fluxo mobile).
 */

function LearnVisual() {
  const inputs = [
    { label: 'Objetivo', angle: -90 },
    { label: 'Rotina', angle: -18 },
    { label: 'Experiência', angle: 54 },
    { label: 'Disponibilidade', angle: 126 },
    { label: 'Limitações', angle: 198 },
  ];
  return (
    <svg viewBox="0 0 400 400" className={styles.svg}>
      <circle cx="200" cy="200" r="120" className={styles.ring} />
      <circle cx="200" cy="200" r="84" className={styles.ringSoft} />
      {inputs.map(({ label, angle }, index) => {
        const rad = (angle * Math.PI) / 180;
        const x = 200 + Math.cos(rad) * 120;
        const y = 200 + Math.sin(rad) * 120;
        const labelX = 200 + Math.cos(rad) * 150;
        const labelY = 200 + Math.sin(rad) * 150;
        return (
          <g
            key={label}
            className={styles.learnInput}
            style={{ animationDelay: `${index * 90}ms` }}
          >
            <line x1={x} y1={y} x2="200" y2="200" className={styles.flow} />
            <circle cx={x} cy={y} r="7" className={styles.node} />
            <text
              x={labelX}
              y={labelY}
              className={styles.label}
              textAnchor={
                Math.abs(Math.cos(rad)) < 0.2 ? 'middle' : Math.cos(rad) > 0 ? 'start' : 'end'
              }
              dominantBaseline="middle"
            >
              {label}
            </text>
          </g>
        );
      })}
      <circle cx="200" cy="200" r="30" className={styles.core} />
      <circle cx="200" cy="200" r="7" className={styles.pulseDot} />
    </svg>
  );
}

function BuildVisual() {
  const days = [
    { d: 'S', blocks: [52, 34] },
    { d: 'T', blocks: [40, 44] },
    { d: 'Q', blocks: [] },
    { d: 'Q', blocks: [56, 30] },
    { d: 'S', blocks: [36, 46], today: true },
    { d: 'S', blocks: [30] },
    { d: 'D', blocks: [] },
  ];
  return (
    <svg viewBox="0 0 400 400" className={styles.svg}>
      <line x1="40" y1="316" x2="360" y2="316" className={styles.ringSoft} />
      {days.map((day, index) => {
        const x = 52 + index * 46;
        let top = 316;
        return (
          <g key={index}>
            {day.blocks.length === 0 ? (
              <rect x={x - 15} y="284" width="30" height="24" rx="8" className={styles.rest} />
            ) : (
              day.blocks.map((height, blockIndex) => {
                top -= height + 6;
                return (
                  <rect
                    key={blockIndex}
                    x={x - 15}
                    y={top}
                    width="30"
                    height={height}
                    rx="8"
                    className={cn(
                      styles.block,
                      day.today && blockIndex === day.blocks.length - 1 && styles.blockToday,
                    )}
                    style={{ animationDelay: `${index * 70 + blockIndex * 40}ms` }}
                  />
                );
              })
            )}
            <text x={x} y="342" className={styles.label} textAnchor="middle">
              {day.d}
            </text>
          </g>
        );
      })}
      <path d="M40 96 H360" className={styles.ringSoft} />
      <text x="40" y="80" className={styles.labelStrong}>
        Semana 01
      </text>
      <text x="360" y="80" className={styles.label} textAnchor="end">
        5 sessões
      </text>
    </svg>
  );
}

function VerifyVisual() {
  return (
    <svg viewBox="0 0 400 400" className={styles.svg}>
      <rect x="92" y="60" width="216" height="280" rx="20" className={styles.card} />
      {[108, 136, 164, 192].map((y, index) => (
        <line
          key={y}
          x1="124"
          y1={y}
          x2={index % 2 ? 236 : 276}
          y2={y}
          className={styles.textLine}
        />
      ))}
      <path
        d="M124 262 C 146 236, 158 280, 176 254 S 204 244, 214 262 S 238 250, 252 256"
        className={styles.signature}
        pathLength={1}
      />
      <line x1="124" y1="280" x2="252" y2="280" className={styles.ringSoft} />
      <g className={styles.seal}>
        <circle cx="286" cy="300" r="46" className={styles.sealRing} />
        <circle cx="286" cy="300" r="36" className={styles.ringSoft} />
        <text x="286" y="296" className={styles.sealText} textAnchor="middle">
          CREF
        </text>
        <path d="M272 310 l9 8 l18 -18" className={styles.check} pathLength={1} />
      </g>
    </svg>
  );
}

function MoveVisual() {
  return (
    <svg viewBox="0 0 400 400" className={styles.svg}>
      <rect x="128" y="44" width="144" height="300" rx="30" className={styles.card} />
      <rect x="148" y="92" width="92" height="30" rx="12" className={styles.bubble} />
      <rect x="164" y="134" width="88" height="30" rx="12" className={styles.bubbleOut} />
      <rect x="148" y="176" width="100" height="42" rx="12" className={styles.bubble} />
      <path
        d="M20 286 H130 L146 256 L164 312 L184 232 L200 286 H380"
        className={styles.wave}
        pathLength={1}
      />
      <circle cx="380" cy="286" r="6" className={styles.pulseDot} />
    </svg>
  );
}

export const ACT_VISUALS = [LearnVisual, BuildVisual, VerifyVisual, MoveVisual] as const;

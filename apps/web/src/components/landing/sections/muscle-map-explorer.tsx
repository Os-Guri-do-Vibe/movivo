'use client';

import { useRef, useState } from 'react';
import dynamic from 'next/dynamic';

import { cn } from '@/lib/utils';

import { useNearViewport } from '../ui/use-near-viewport';

import type { MuscleGroupId } from './muscle-map-figures';
import styles from './muscle-map.module.css';

const MuscleMapFigures = dynamic(() => import('./muscle-map-figures'), {
  ssr: false,
  loading: () => <div className={styles.figuresLoading} />,
});

export const MUSCLE_EXAMPLE: readonly {
  group: MuscleGroupId;
  label: string;
  frequency: string;
  status: string;
}[] = [
  { group: 'chest', label: 'Peito', frequency: '2× semana', status: 'Progressão monitorada' },
  {
    group: 'triceps',
    label: 'Tríceps',
    frequency: '2× semana',
    status: 'Volume distribuído na semana',
  },
  {
    group: 'shoulders',
    label: 'Ombros',
    frequency: '2× semana',
    status: 'Carga ajustada após feedback',
  },
];

const WEEK = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'] as const;
/** Dias do exemplo em que o treino A (empurrar) acontece: segunda e quinta. */
const TRAINING_DAYS = new Set([0, 3]);
const GROUPS = MUSCLE_EXAMPLE.map((muscle) => muscle.group);

export function MuscleMapExplorer() {
  const [selected, setSelected] = useState<MuscleGroupId>('chest');
  const figuresRef = useRef<HTMLDivElement>(null);
  const near = useNearViewport(figuresRef);
  const current = MUSCLE_EXAMPLE.find((muscle) => muscle.group === selected) ?? MUSCLE_EXAMPLE[0];

  return (
    <div className={styles.explorer}>
      <div ref={figuresRef} className={styles.figuresWrap}>
        {near ? (
          <MuscleMapFigures groups={GROUPS} selected={selected} onSelect={setSelected} />
        ) : (
          <div className={styles.figuresLoading} />
        )}
      </div>

      <div className={styles.controls}>
        <p className={styles.controlsLabel}>Exemplo de protocolo · Treino de hoje</p>
        <div className={styles.chips} role="group" aria-label="Grupos musculares do treino">
          {MUSCLE_EXAMPLE.map((muscle) => (
            <button
              key={muscle.group}
              type="button"
              className={cn(styles.chip, muscle.group === selected && styles.chipActive)}
              aria-pressed={muscle.group === selected}
              onClick={() => setSelected(muscle.group)}
            >
              <span className={styles.chipDot} aria-hidden="true" />
              {muscle.label}
            </button>
          ))}
        </div>

        {current ? (
          <div className={styles.panel} aria-live="polite">
            <p className={styles.panelTitle}>{current.label}</p>
            <dl className={styles.panelData}>
              <div>
                <dt>Frequência</dt>
                <dd>{current.frequency}</dd>
              </div>
              <div>
                <dt>Acompanhamento</dt>
                <dd>{current.status}</dd>
              </div>
            </dl>
            <ol className={styles.week} aria-label="Dias de treino no exemplo: segunda e quinta">
              {WEEK.map((day, index) => (
                <li
                  key={index}
                  className={cn(styles.weekDay, TRAINING_DAYS.has(index) && styles.weekDayOn)}
                  aria-hidden="true"
                >
                  {day}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </div>
  );
}

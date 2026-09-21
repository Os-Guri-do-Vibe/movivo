'use client';

import type { WorkoutShareCardData } from '@movivo/shared';
import { MuscleMap } from 'js-rich-body-highlighter/react';
import { Check, Clock3 } from 'lucide-react';
import Image from 'next/image';
import { useId, type Ref } from 'react';

import { formatShareCardDuration } from './generateWorkoutShareCard';
import styles from './workout-share-card.module.css';

export const WORKOUT_CARD_WIDTH = 1080;
export const WORKOUT_CARD_HEIGHT = 1920;
export const PULSE_GREEN = '#25E27E';

/** Tamanho fixo de Story: a prévia é reduzida, mas a composição exportada nunca muda. */
export function WorkoutShareCard({
  data,
  cardRef,
}: {
  data: WorkoutShareCardData;
  cardRef?: Ref<HTMLDivElement>;
}) {
  const hairId = useId();
  const muscles = [...new Set(data.workout.trainedMuscles)];
  const highlights = data.workout.muscleGroupsForHighlighter.map((group) => ({
    group,
    intensity: 90,
    color: PULSE_GREEN,
  }));
  return (
    <div
      ref={cardRef}
      className={styles.card}
      data-workout-share-card
      role="img"
      aria-label={`Treino concluído. ${muscles.join(', ')}. Tempo de Treino: ${formatShareCardDuration(data.workout.durationMinutes)}.`}
    >
      <div className={styles.accentTop} />
      <div className={styles.accentBottom} />
      <header className={styles.header}>
        <p>MOVE YOUR POTENTIAL.</p>
      </header>
      <div className={styles.grid}>
        <div className={styles.anatomy}>
          <div className={styles.bodies} aria-hidden="true">
            {(['front', 'back'] as const).map((view) => (
              <div key={view} className={styles.bodyColumn}>
                <MuscleMap
                  className={styles.body}
                  gender={data.user.gender}
                  view={view}
                  theme="dark"
                  width={360}
                  highlights={highlights}
                  color={PULSE_GREEN}
                  blendMode="hard-light"
                  hoverHighlight={false}
                />
                {data.user.gender === 'female' && (
                  <svg
                    className={styles.hair}
                    viewBox="0 0 1280 1920"
                    aria-hidden="true"
                    data-female-hair={view}
                  >
                    <defs>
                      <radialGradient id={`${hairId}-${view}`} cx="35%" cy="25%" r="80%">
                        <stop offset="0" stopColor="#7e8791" />
                        <stop offset="0.45" stopColor="#424a55" />
                        <stop offset="1" stopColor="#1e252e" />
                      </radialGradient>
                    </defs>
                    {/* Mesmo enquadramento do corpo: o cabelo cobre apenas o couro cabeludo. */}
                    <g fill={`url(#${hairId}-${view})`} stroke="#343c46" strokeWidth="3">
                      <ellipse cx="642" cy="106" rx="40" ry="35" />
                      <path
                        d={
                          view === 'front'
                            ? 'M565 228 C557 182 565 137 600 119 C626 105 657 105 681 120 C714 138 724 182 715 228 L702 247 C705 210 693 182 681 160 C661 169 632 158 618 145 C591 160 579 202 578 247 Z'
                            : 'M565 229 C557 183 565 138 599 119 C625 104 657 105 681 119 C713 137 724 183 715 229 L702 265 C685 276 663 271 643 263 C623 271 602 276 584 265 Z'
                        }
                      />
                    </g>
                    <g
                      fill="none"
                      stroke="#a0a8b0"
                      strokeWidth="2"
                      opacity="0.4"
                      strokeLinecap="round"
                    >
                      <path d="M615 112 C607 93 627 79 645 81 M626 112 C618 98 637 85 654 90 M639 112 C634 100 651 95 666 104" />
                      {view === 'front' ? (
                        <path d="M574 201 Q570 151 610 129 M584 181 Q589 147 615 137 M630 124 Q688 123 707 193 M637 135 Q681 139 699 178" />
                      ) : (
                        <path d="M577 234 Q566 163 619 127 M594 250 Q579 177 627 128 M613 258 Q596 186 636 130 M665 258 Q687 183 649 130 M687 248 Q709 175 658 127 M706 228 Q722 164 666 125" />
                      )}
                    </g>
                  </svg>
                )}
                <span>{view === 'front' ? 'FRENTE' : 'COSTAS'}</span>
              </div>
            ))}
          </div>
          <div className={styles.anatomyLegend}>
            <i /> MOVIMENTO EM DESTAQUE
          </div>
        </div>
        <div className={styles.details}>
          <Image
            src="/brand/movivo-logo-horizontal.svg"
            alt="MOVIVO"
            width={400}
            height={104}
            unoptimized
            loading="eager"
            className={styles.logo}
          />
          <div className={styles.badge}>
            <Check size={30} strokeWidth={3} /> TREINO CONCLUÍDO
          </div>
          <div className={styles.duration}>
            <Clock3 size={48} strokeWidth={1.5} />
            <div>
              <span>Tempo de Treino</span>
              <strong>{formatShareCardDuration(data.workout.durationMinutes)}</strong>
            </div>
          </div>
          <p className={styles.motto}>BETTER THAN YESTERDAY.</p>
          <p className={styles.follow}>
            Siga <strong>@movivo.br</strong>
          </p>
        </div>
      </div>
    </div>
  );
}

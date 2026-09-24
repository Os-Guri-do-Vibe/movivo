'use client';

import { MuscleMap } from 'js-rich-body-highlighter/react';

import styles from './muscle-map.module.css';

/** Mesmo tratamento visual do Workout Share Card: corpo escuro, Verde Pulso em hard-light. */
export const PULSE_GREEN = '#25E27E';

export type MuscleGroupId = 'chest' | 'triceps' | 'shoulders';

type MuscleMapFiguresProps = {
  groups: readonly MuscleGroupId[];
  selected: MuscleGroupId;
  onSelect: (group: MuscleGroupId) => void;
};

function isTrackedGroup(groups: readonly MuscleGroupId[], group: string): group is MuscleGroupId {
  return (groups as readonly string[]).includes(group);
}

/**
 * Frente e costas lado a lado. O grupo selecionado acende forte; os demais do treino do
 * dia ficam em meia intensidade. Clique no músculo também seleciona (desktop), mas a
 * seleção nunca depende só de hover/clique no corpo: os chips são o controle principal.
 */
export default function MuscleMapFigures({ groups, selected, onSelect }: MuscleMapFiguresProps) {
  const highlights = groups.map((group) => ({
    group,
    intensity: group === selected ? 96 : 42,
    color: PULSE_GREEN,
  }));

  return (
    <div className={styles.figures} aria-hidden="true">
      {(['front', 'back'] as const).map((view) => (
        <div key={view} className={styles.figure}>
          <MuscleMap
            className={styles.body}
            gender="male"
            view={view}
            theme="dark"
            width="100%"
            highlights={highlights}
            color={PULSE_GREEN}
            blendMode="hard-light"
            hoverHighlight
            hoverIntensity={30}
            onMuscleClick={(muscle) => {
              if (isTrackedGroup(groups, muscle.group)) onSelect(muscle.group);
            }}
          />
          <span className={styles.viewLabel}>{view === 'front' ? 'Frente' : 'Costas'}</span>
        </div>
      ))}
    </div>
  );
}

import { cn } from '@/lib/utils';
import { SECTION_IDS } from '@/lib/landing/site';

import landing from '../landing.module.css';
import { RevealLines } from '../ui/reveal-lines';

import { MuscleMapExplorer } from './muscle-map-explorer';
import styles from './muscle-map.module.css';

export function MuscleMapSection() {
  return (
    <section
      id={SECTION_IDS.muscleMap}
      className={cn(landing.section, landing.themeGraphite, styles.muscle)}
      aria-labelledby="muscle-title"
      data-section-view="muscle_map"
    >
      <div className={cn(landing.container, styles.layout)}>
        <header className={styles.header}>
          <RevealLines
            id="muscle-title"
            className={landing.h2}
            lines={['Cada treino', 'tem contexto.']}
          />
          <p className={cn(landing.body, landing.secondaryText, styles.body)} data-reveal="">
            A MOVIVO organiza estímulos, frequência e progressão para que o protocolo tenha
            continuidade, não apenas exercícios soltos.
          </p>
        </header>
        <MuscleMapExplorer />
      </div>
    </section>
  );
}

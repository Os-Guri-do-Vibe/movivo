import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';
import { SECTION_IDS } from '@/lib/landing/site';

import landing from '../landing.module.css';
import { PULSE_NUCLEI } from '../scenes/pulse-layout';
import { RevealLines } from '../ui/reveal-lines';

import { PulseSystemStage } from './pulse-system-stage';
import styles from './pulse-system.module.css';

const CONCEPTS = [
  'Você',
  'Rotina',
  'Objetivo',
  'Treino',
  'Feedback',
  'Adaptação',
  'Evolução',
] as const;

function nucleusStyle(index: number): CSSProperties {
  const nucleus = PULSE_NUCLEI[index];
  if (!nucleus) return {};
  return {
    left: `${((nucleus.x + 1) / 2) * 100}%`,
    top: `${((1 - nucleus.y) / 2) * 100}%`,
  };
}

/** Estado estático do sistema: primeira pintura, sem WebGL e com movimento reduzido. */
function PulseFallback() {
  return (
    <div className={styles.fallback}>
      <svg className={styles.fallbackLines} preserveAspectRatio="none" viewBox="0 0 100 100">
        {PULSE_NUCLEI.map((nucleus) => (
          <line
            key={nucleus.label}
            x1="50"
            y1="50"
            x2={((nucleus.x + 1) / 2) * 100}
            y2={((1 - nucleus.y) / 2) * 100}
          />
        ))}
      </svg>
      <span className={styles.fallbackHalo} />
      <span className={styles.fallbackSphere} />
      {PULSE_NUCLEI.map((nucleus, index) => (
        <span key={nucleus.label} className={styles.fallbackNucleus} style={nucleusStyle(index)} />
      ))}
    </div>
  );
}

export function PulseSystem() {
  const copy = (
    <>
      <RevealLines
        id="system-title"
        className={cn(landing.h2, styles.title)}
        lines={['Um sistema construído', 'ao redor de você.']}
      />
      <p className={cn(landing.body, landing.secondaryText, styles.body)} data-reveal="">
        Objetivo, rotina, disponibilidade, experiência, recuperação e evolução deixam de ser dados
        soltos e passam a trabalhar juntos.
      </p>
      <ol className={styles.concepts} aria-label="Como o sistema conecta cada parte">
        {CONCEPTS.map((concept, index) => (
          <li key={concept} className={styles.concept} data-concept="">
            <span className={styles.conceptIndex}>{String(index + 1).padStart(2, '0')}</span>
            {concept}
          </li>
        ))}
      </ol>
    </>
  );

  const contexts = (
    <ul className={styles.contexts} aria-label="Quatro contextos conectados">
      {PULSE_NUCLEI.map((nucleus, index) => (
        <li key={nucleus.label} className={styles.context} style={nucleusStyle(index)}>
          {nucleus.label}
        </li>
      ))}
    </ul>
  );

  return (
    <section
      id={SECTION_IDS.system}
      className={cn(landing.themePetroleum, styles.system)}
      aria-labelledby="system-title"
      data-section-view="pulse"
    >
      <PulseSystemStage copy={copy} contexts={contexts} fallback={<PulseFallback />} />
    </section>
  );
}

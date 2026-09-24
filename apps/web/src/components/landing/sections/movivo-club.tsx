import { cn } from '@/lib/utils';
import { SECTION_IDS } from '@/lib/landing/site';

import landing from '../landing.module.css';
import { buildClubLayout } from '../scenes/club-layout';
import { RevealLines } from '../ui/reveal-lines';

import { ClubStage } from './club-stage';
import styles from './movivo-club.module.css';

/** Constelação estática (mesmo layout determinístico da cena), para sem WebGL/reduzido. */
function ClubFallback() {
  const { points, links } = buildClubLayout(90);
  const toX = (x: number) => 50 + x * 46;
  const toY = (y: number) => 50 - y * 40;
  return (
    <svg className={styles.fallback} viewBox="0 0 100 100" preserveAspectRatio="none">
      {links.map(([a, b]) => {
        const from = points[a];
        const to = points[b];
        if (!from || !to) return null;
        return (
          <line
            key={`${a}-${b}`}
            x1={toX(from.x)}
            y1={toY(from.y)}
            x2={toX(to.x)}
            y2={toY(to.y)}
            className={styles.fallbackLink}
          />
        );
      })}
      {points.map((point, index) => (
        <circle
          key={index}
          cx={toX(point.x)}
          cy={toY(point.y)}
          r={point.milestone ? 0.55 : 0.3}
          className={styles.fallbackPoint}
        />
      ))}
    </svg>
  );
}

export function MovivoClub() {
  return (
    <section
      id={SECTION_IDS.club}
      className={cn(landing.themeDeep, styles.club)}
      aria-labelledby="club-title"
      data-section-view="club"
    >
      <ClubStage fallback={<ClubFallback />} />
      <div className={styles.scrim} aria-hidden="true" />
      <div className={cn(landing.container, styles.content)}>
        <RevealLines
          id="club-title"
          className={cn(landing.h2, styles.title)}
          lines={['Você se move por você.', 'Mas não precisa', 'se mover sozinho.']}
        />
        <p className={cn(landing.lead, styles.body)} data-reveal="">
          O MOVIVO CLUB conecta pessoas que escolheram transformar consistência em identidade.
        </p>
        <p className={styles.micro} lang="en" data-reveal="">
          Challenges · milestones · community
        </p>
      </div>
    </section>
  );
}

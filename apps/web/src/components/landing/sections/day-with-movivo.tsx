import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { movivoAssets, type AssetPath } from '@/lib/landing/assets';
import { SECTION_IDS } from '@/lib/landing/site';

import landing from '../landing.module.css';
import { SectionMotion } from '../motion/section-motion';
import { MediaSlot } from '../ui/media-slot';
import { RevealLines } from '../ui/reveal-lines';

import styles from './day-with-movivo.module.css';

type Moment = {
  slot: string;
  time: string;
  text: string;
  kind: 'message' | 'status';
  asset: AssetPath;
  alt: string;
  fallback: ReactNode;
};

/* --- Composições editoriais enquanto as fotos do dia não existem ------------ */

function MorningComposition() {
  return (
    <div className={cn(styles.comp, styles.morning)}>
      <span className={styles.sun} />
      <span className={styles.horizon} />
      <span className={styles.architecture} />
    </div>
  );
}

function MiddayComposition() {
  const agenda = [
    { time: '08:00', label: 'Trabalho' },
    { time: '12:00', label: 'Almoço' },
    { time: '13:30', label: 'Trabalho' },
    { time: '18:30', label: 'Treino A', pulse: true },
  ];
  return (
    <div className={cn(styles.comp, styles.midday)}>
      <div className={styles.agenda}>
        <p className={styles.agendaTitle}>Hoje</p>
        <ol className={styles.agendaList}>
          {agenda.map((item, index) => (
            <li key={index} className={cn(styles.agendaRow, item.pulse && styles.agendaPulse)}>
              <span className={styles.agendaTime}>{item.time}</span>
              <span className={styles.agendaLabel}>{item.label}</span>
            </li>
          ))}
          <li className={styles.agendaNow} aria-hidden="true">
            <span>12:42</span>
          </li>
        </ol>
      </div>
    </div>
  );
}

function PreWorkoutComposition() {
  return (
    <div className={cn(styles.comp, styles.evening)}>
      <div className={styles.ready}>
        <svg viewBox="0 0 120 120" className={styles.ring}>
          <circle cx="60" cy="60" r="52" className={styles.ringTrack} />
          <circle cx="60" cy="60" r="52" className={styles.ringStart} pathLength={100} />
        </svg>
        <div className={styles.readyInfo}>
          <span className={styles.readyTag}>Treino A</span>
          <ul className={styles.readyList}>
            <li>Supino inclinado</li>
            <li>Tríceps na polia</li>
            <li>Elevação lateral</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function WorkoutComposition() {
  return (
    <div className={cn(styles.comp, styles.night)}>
      <div className={styles.done}>
        <svg viewBox="0 0 120 120" className={styles.ring}>
          <circle cx="60" cy="60" r="52" className={styles.ringTrackDark} />
          <circle cx="60" cy="60" r="52" className={styles.ringDone} pathLength={100} />
          <path d="M42 61l12 12 24-26" className={styles.doneCheck} />
        </svg>
        <div className={styles.sets}>
          {[1, 1, 1, 1, 1, 1].map((_, index) => (
            <span key={index} />
          ))}
        </div>
      </div>
    </div>
  );
}

function RecoveryComposition() {
  return (
    <div className={cn(styles.comp, styles.recovery)}>
      <span className={styles.breath} />
      <span className={cn(styles.breath, styles.breathLate)} />
      <svg viewBox="0 0 100 100" className={styles.moon}>
        <path d="M62 18a34 34 0 1 0 20 58A28 28 0 1 1 62 18z" />
      </svg>
    </div>
  );
}

const MOMENTS: readonly Moment[] = [
  {
    slot: 'day-morning',
    time: '07:08',
    text: 'Bom dia. Como você dormiu hoje?',
    kind: 'message',
    asset: movivoAssets.dayWithMovivo.morning,
    alt: 'Manhã: início do dia com a MOVIVO',
    fallback: <MorningComposition />,
  },
  {
    slot: 'day-midday',
    time: '12:42',
    text: 'Seu treino de hoje está previsto para o fim do dia.',
    kind: 'message',
    asset: movivoAssets.dayWithMovivo.midday,
    alt: 'Meio do dia: o treino encaixado na agenda',
    fallback: <MiddayComposition />,
  },
  {
    slot: 'day-preworkout',
    time: '18:24',
    text: 'Pronto para começar?',
    kind: 'message',
    asset: movivoAssets.dayWithMovivo.preWorkout,
    alt: 'Antes do treino: preparação',
    fallback: <PreWorkoutComposition />,
  },
  {
    slot: 'day-workout',
    time: '19:31',
    text: 'Treino concluído.',
    kind: 'status',
    asset: movivoAssets.dayWithMovivo.workout,
    alt: 'Treino concluído',
    fallback: <WorkoutComposition />,
  },
  {
    slot: 'day-recovery',
    time: '22:14',
    text: 'Boa sessão. Agora começa a recuperação.',
    kind: 'message',
    asset: movivoAssets.dayWithMovivo.recovery,
    alt: 'Noite: recuperação',
    fallback: <RecoveryComposition />,
  },
];

export function DayWithMovivo() {
  return (
    <section
      id={SECTION_IDS.day}
      className={cn(landing.section, landing.themeWhite, styles.day)}
      aria-labelledby="day-title"
      data-section-view="day"
    >
      <div className={landing.container}>
        <header className={styles.header}>
          <RevealLines
            id="day-title"
            className={cn(landing.h2, styles.title)}
            lines={['Treino que cabe na vida.', 'Não o contrário.']}
          />
        </header>

        <SectionMotion effect="day">
          <ol className={styles.moments}>
            {MOMENTS.map((moment) => (
              <li
                key={moment.slot}
                className={styles.moment}
                data-moment=""
                data-slot={moment.slot}
              >
                <div className={styles.copy}>
                  <p className={styles.time} data-time="">
                    <time>{moment.time}</time>
                  </p>
                  {moment.kind === 'status' ? (
                    <p className={styles.status} data-reveal="">
                      <span className={styles.statusDot} aria-hidden="true" />
                      {moment.text}
                    </p>
                  ) : (
                    <p className={styles.message} data-reveal="">
                      <span className={styles.from}>MOVIVO</span>
                      {moment.text}
                    </p>
                  )}
                </div>
                <div className={styles.media} data-media="">
                  <MediaSlot
                    asset={moment.asset}
                    aspectRatio="4 / 3"
                    fallbackVariant="custom"
                    fallback={moment.fallback}
                    alt={moment.alt}
                    sizes="(min-width: 1024px) 44vw, 100vw"
                  />
                </div>
              </li>
            ))}
          </ol>
        </SectionMotion>
      </div>
    </section>
  );
}

import { cn } from '@/lib/utils';
import { LANDING_EVENTS } from '@/lib/landing/analytics';
import { SECTION_IDS } from '@/lib/landing/site';

import landing from '../landing.module.css';
import { SectionMotion } from '../motion/section-motion';
import { TrialCta } from '../ui/pulse-button';
import { RevealLines } from '../ui/reveal-lines';

import { ACT_VISUALS } from './how-it-works-visuals';
import styles from './how-it-works.module.css';

const ACTS = [
  {
    title: 'Primeiro, entendemos você.',
    text: 'Objetivo, rotina, experiência, disponibilidade, limitações e contexto entram na construção do seu plano.',
  },
  {
    title: 'Depois, construímos o plano.',
    text: 'A MOVIVO organiza essas informações, dentro da metodologia escrita pelos profissionais, para criar um plano de treino e de alimentação coerente com a sua realidade.',
  },
  {
    title: 'Tecnologia com responsabilidade humana.',
    text: 'A IA trabalha dentro de regras definidas por profissionais registrados, que entram nos casos sensíveis.',
  },
  {
    title: 'O treino chega onde você já está.',
    text: 'Tudo pelo WhatsApp: a sessão do dia, orientação, registros e ajustes.',
  },
] as const;

export function HowItWorks() {
  return (
    <section
      id={SECTION_IDS.howItWorks}
      className={cn(landing.section, landing.themeLight, styles.how)}
      aria-labelledby="how-title"
      data-section-view="how_it_works"
    >
      <div className={landing.container}>
        <header className={styles.header}>
          <RevealLines
            id="how-title"
            className={cn(landing.h2, styles.title)}
            lines={['Do seu contexto ao seu treino.']}
          />
        </header>

        <SectionMotion effect="howItWorks">
          <div className={styles.layout} data-how-layout="" data-active-act="0">
            <div className={styles.stage} aria-hidden="true">
              <div className={styles.stageFrame}>
                {ACT_VISUALS.map((Visual, index) => (
                  <div key={index} className={styles.stageVisual} data-visual={index}>
                    <Visual />
                  </div>
                ))}
                <ol className={styles.progress}>
                  {ACTS.map((act, index) => (
                    <li key={act.title} data-step={index}>
                      {String(index + 1).padStart(2, '0')}
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            <ol className={styles.acts}>
              {ACTS.map((act, index) => {
                const Visual = ACT_VISUALS[index];
                return (
                  <li key={act.title} className={styles.act} data-act={index}>
                    {Visual ? (
                      <div className={styles.actVisual} aria-hidden="true">
                        <Visual />
                      </div>
                    ) : null}
                    <p className={styles.actLabel}>{String(index + 1).padStart(2, '0')}</p>
                    <h3 className={cn(landing.h3, styles.actTitle)}>{act.title}</h3>
                    <p className={cn(landing.body, landing.secondaryText)}>{act.text}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </SectionMotion>

        <div className={styles.cta}>
          <TrialCta event={LANDING_EVENTS.howItWorksStart} width="block">
            Começar meu plano
          </TrialCta>
          <p className={cn(landing.secondaryText, styles.ctaNote)}>
            7 dias grátis · sem cobrança durante o teste
          </p>
        </div>
      </div>
    </section>
  );
}

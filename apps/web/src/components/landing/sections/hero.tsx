import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';
import { LANDING_EVENTS } from '@/lib/landing/analytics';
import { hasHeroVideo, heroPoster, movivoAssets } from '@/lib/landing/assets';
import { SECTION_IDS } from '@/lib/landing/site';

import landing from '../landing.module.css';
import { CinematicBackdrop } from '../ui/cinematic-backdrop';
import { PulseLink, TrialCta } from '../ui/pulse-button';

import { HeroMedia } from './hero-media';
import { HeroPoster } from './hero-poster';
import styles from './hero.module.css';

/** Palavra digitada no H1 (o CSS dá a caixa alta). */
const TYPED_WORD = 'potential.';

/**
 * Hero cinematográfico. Pilha (tudo dentro da seção, nada `fixed`):
 *   filme (pôster SSR + vídeo) → 4 máscaras independentes → conteúdo → scroll cue.
 * O filme é o protagonista; as máscaras só protegem a região da copy.
 */
export function Hero() {
  const hero = movivoAssets.hero;
  const poster = heroPoster(hero, false);

  return (
    <section
      id={SECTION_IDS.top}
      className={cn(styles.hero, landing.themeDeep)}
      aria-labelledby="hero-title"
      data-section-view="hero"
    >
      <div className={styles.film} data-hero-film="" aria-hidden="true">
        {poster ? (
          <HeroPoster desktop={poster} mobile={hero.mobilePoster} />
        ) : (
          <CinematicBackdrop variant="hero" />
        )}
        {hasHeroVideo(hero) ? <HeroMedia assets={hero} /> : null}
      </div>

      {/* Máscaras cinematográficas: cada uma com um papel, nenhuma captura clique. */}
      <div className={cn(styles.mask, styles.maskBase)} aria-hidden="true" />
      <div className={cn(styles.mask, styles.maskReadability)} aria-hidden="true" />
      <div className={cn(styles.mask, styles.maskCinematic)} aria-hidden="true" />
      <div className={cn(styles.mask, styles.maskVignette)} aria-hidden="true" />

      <div className={cn(landing.containerWide, styles.content)}>
        <div className={styles.copy}>
          <h1 id="hero-title" className={styles.title} lang="en">
            <span className={landing.line}>
              <span className={cn(landing.lineInner, styles.titleLine)}>Move your</span>
            </span>{' '}
            {/* Digitação em loop, em CSS (sem esperar o JS): cada tecla tem o seu instante
                de surgir e de ser apagada, e o cursor acompanha a última. O leitor de tela
                recebe a palavra inteira, sem repetição. */}
            <span
              className={styles.typed}
              style={{ '--key-last': TYPED_WORD.length - 1 } as CSSProperties}
            >
              <span className="sr-only">{TYPED_WORD}</span>
              <span aria-hidden="true">
                {Array.from(TYPED_WORD, (char, index) => (
                  <span
                    key={index}
                    className={styles.key}
                    style={
                      {
                        '--key': index,
                        '--key-rev': TYPED_WORD.length - 1 - index,
                      } as CSSProperties
                    }
                  >
                    {char}
                  </span>
                ))}
              </span>
            </span>
          </h1>
          <p className={cn(landing.lead, styles.lead)}>
            Treino individualizado, inteligência contínua e respaldo humano, direto no WhatsApp.
          </p>
          <div className={styles.actions}>
            <div className={styles.primaryGroup}>
              <TrialCta
                event={LANDING_EVENTS.heroStartTrial}
                width="block"
                magnetic={false}
                className={styles.primaryCta}
              >
                Começar 7 dias grátis
              </TrialCta>
              <p className={styles.micro}>Teste sem cadastrar nenhum cartão</p>
            </div>
            <PulseLink
              href={`#${SECTION_IDS.manifesto}`}
              event={LANDING_EVENTS.heroLearnMore}
              variant="secondary"
              width="block"
              arrow={false}
              magnetic={false}
              className={styles.secondaryCta}
            >
              Conheça a MOVIVO
            </PulseLink>
          </div>
        </div>
      </div>

      <a href={`#${SECTION_IDS.manifesto}`} className={styles.scrollCue} lang="en">
        <span>Scroll to move</span>
        <span className={styles.scrollLine} aria-hidden="true" />
      </a>
    </section>
  );
}

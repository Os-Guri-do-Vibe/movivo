'use client';

import { useEffect, useLayoutEffect } from 'react';

import { captureFirstTouch } from '@/lib/first-touch';
import {
  LANDING_SECTIONS,
  sectionViewEvent,
  trackLandingEvent,
  type LandingSection,
} from '@/lib/landing/analytics';

import { scrollToSection } from '../ui/scroll-to-section';
import { LANDING_ROOT_SELECTOR } from '../ui/use-landing-portal';

import { loadGsap, MOTION_QUERIES, type MotionConditions } from './gsap';

const SECTION_SET = new Set<string>(LANDING_SECTIONS);

function isLandingSection(value: string | undefined): value is LandingSection {
  return value !== undefined && SECTION_SET.has(value);
}

/** Clique simples (sem modificador): Ctrl/⌘/Shift/botão do meio seguem o navegador. */
function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * Comportamento global da landing, montado uma vez:
 *  - a landing sempre abre no hero (F5 e "voltar" da anamnese incluídos) e a URL fica
 *    sem `#seção`; âncoras internas rolam via script (`scrollToSection`);
 *  - primeiro toque (US-8.2): a query string chega aqui e some ao navegar para a anamnese;
 *  - `section_view_*`: uma vez por seção por visita, quando ~35% dela aparece;
 *  - reveals editoriais (`[data-reveal]`, `[data-reveal-lines]`) via GSAP/ScrollTrigger,
 *    só para o que ainda está abaixo da dobra — nada que já está visível pisca.
 */
export function LandingRuntime() {
  /*
   * Layout effect: ao voltar da anamnese, a landing precisa aparecer já no topo, sem
   * pintar um quadro na rolagem herdada. Com `manual`, o navegador não restaura a
   * rolagem desta entrada no F5/voltar. Um link externo com âncora (`/#planos`) ainda
   * leva à seção, e o hash sai da URL — o próximo F5 já abre no hero.
   *
   * `history.state` é repassado de propósito: na hidratação este efeito roda antes de o
   * App Router instalar o patch de `replaceState`, e um `null` apagaria o estado interno
   * do Next desta entrada — o "voltar" até ela voltaria a ser ignorado.
   */
  useLayoutEffect(() => {
    const { history } = window;
    const previous = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    const { hash, pathname, search } = window.location;
    const deepLink = hash ? document.getElementById(hash.slice(1)) : null;
    if (hash) history.replaceState(history.state, '', pathname + search);
    // Instantâneo: a rolagem suave nativa até o fragmento é interrompida na hidratação.
    if (deepLink) deepLink.scrollIntoView({ block: 'start', behavior: 'instant' });
    else window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    return () => {
      history.scrollRestoration = previous;
    };
  }, []);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      // `defaultPrevented`: o menu mobile trata a própria âncora depois de fechar.
      if (event.defaultPrevented || !isPlainClick(event)) return;
      const anchor = event.target instanceof Element ? event.target.closest('a') : null;
      const href = anchor?.getAttribute('href');
      if (!href?.startsWith('#') || href.length < 2) return;
      if (scrollToSection(href.slice(1))) event.preventDefault();
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    captureFirstTouch();
  }, []);

  useEffect(() => {
    if (typeof IntersectionObserver !== 'function') return;
    const seen = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const section = (entry.target as HTMLElement).dataset.sectionView;
          if (!entry.isIntersecting || !isLandingSection(section) || seen.has(section)) continue;
          seen.add(section);
          trackLandingEvent(sectionViewEvent(section));
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.35 },
    );
    document
      .querySelectorAll<HTMLElement>('[data-section-view]')
      .forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const root = document.querySelector<HTMLElement>(LANDING_ROOT_SELECTOR);
    if (!root) return;
    let cancelled = false;
    let revert: (() => void) | undefined;

    void loadGsap().then(({ gsap, ScrollTrigger }) => {
      if (cancelled) return;
      const mm = gsap.matchMedia(root);
      mm.add(MOTION_QUERIES, (context) => {
        const { motion, mobile } = context.conditions as MotionConditions;
        if (!motion) return;
        const belowFold = (element: Element) =>
          element.getBoundingClientRect().top > window.innerHeight * 0.92;

        const y = mobile ? 20 : 32;
        const blur = mobile ? 4 : 8;
        const duration = mobile ? 0.7 : 0.85;
        const blocks = gsap.utils.toArray<HTMLElement>('[data-reveal]', root).filter(belowFold);
        if (blocks.length) gsap.set(blocks, { opacity: 0, y, filter: `blur(${blur}px)` });
        ScrollTrigger.batch(blocks, {
          start: 'top 88%',
          once: true,
          onEnter: (batch) =>
            gsap.to(batch, {
              opacity: 1,
              y: 0,
              filter: 'blur(0px)',
              duration,
              ease: 'power3.out',
              stagger: 0.08,
              overwrite: true,
              clearProps: 'filter,transform',
            }),
        });

        for (const heading of gsap.utils.toArray<HTMLElement>('[data-reveal-lines]', root)) {
          if (!belowFold(heading)) continue;
          const lines = heading.querySelectorAll('.mv-line');
          gsap.set(lines, { yPercent: 105 });
          ScrollTrigger.create({
            trigger: heading,
            start: 'top 86%',
            once: true,
            onEnter: () =>
              gsap.to(lines, {
                yPercent: 0,
                duration: mobile ? 0.9 : 1.1,
                ease: 'power3.out',
                stagger: 0.1,
              }),
          });
        }
      });

      // Fontes trocando de fallback mudam alturas: recalcula os gatilhos uma vez.
      void document.fonts?.ready.then(() => {
        if (!cancelled) ScrollTrigger.refresh();
      });
      revert = () => mm.revert();
    });

    return () => {
      cancelled = true;
      revert?.();
    };
  }, []);

  return null;
}

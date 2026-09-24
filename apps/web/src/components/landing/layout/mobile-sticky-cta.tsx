'use client';

import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';
import { LANDING_EVENTS } from '@/lib/landing/analytics';
import { SECTION_IDS } from '@/lib/landing/site';

import { TrialCta } from '../ui/pulse-button';

import styles from './mobile-sticky-cta.module.css';

/** Aparece depois de ~120% da altura da tela; some quando os planos ou o CTA final entram. */
const SHOW_AFTER_VIEWPORTS = 1.2;

export function MobileStickyCta() {
  const [pastHero, setPastHero] = useState(false);
  const [nearConversion, setNearConversion] = useState(false);

  useEffect(() => {
    let frame = 0;
    function update() {
      frame = 0;
      setPastHero(window.scrollY > window.innerHeight * SHOW_AFTER_VIEWPORTS);
    }
    function onScroll() {
      if (!frame) frame = window.requestAnimationFrame(update);
    }
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);

    const targets = [SECTION_IDS.pricing, SECTION_IDS.finalCta, 'rodape']
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    const visible = new Set<Element>();
    const observer =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(
            (entries) => {
              for (const entry of entries) {
                if (entry.isIntersecting) visible.add(entry.target);
                else visible.delete(entry.target);
              }
              setNearConversion(visible.size > 0);
            },
            { rootMargin: '0px 0px -10% 0px' },
          )
        : null;
    for (const target of targets) observer?.observe(target);

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, []);

  const visible = pastHero && !nearConversion;

  return (
    <div className={cn(styles.bar, visible && styles.visible)} data-visible={visible}>
      <TrialCta event={LANDING_EVENTS.stickyMobileStartTrial} width="full" magnetic={false}>
        Começar 7 dias grátis
      </TrialCta>
    </div>
  );
}

/**
 * Carregamento do GSAP sob demanda. O motion nunca entra no caminho crítico: o HTML da
 * landing é legível e navegável sem ele, e o GSAP + ScrollTrigger só são baixados depois
 * da hidratação. Um único registro do plugin para a página inteira.
 */
import type { gsap as Gsap } from 'gsap';
import type { ScrollTrigger as ScrollTriggerClass } from 'gsap/ScrollTrigger';

export type GsapApi = {
  gsap: typeof Gsap;
  ScrollTrigger: typeof ScrollTriggerClass;
};

let loading: Promise<GsapApi> | null = null;

export function loadGsap(): Promise<GsapApi> {
  loading ??= Promise.all([import('gsap'), import('gsap/ScrollTrigger')]).then(
    ([core, trigger]) => {
      core.gsap.registerPlugin(trigger.ScrollTrigger);
      core.gsap.defaults({ ease: 'power3.out' });
      return { gsap: core.gsap, ScrollTrigger: trigger.ScrollTrigger };
    },
  );
  return loading;
}

/** Consultas usadas em `gsap.matchMedia()` — o motion respeita preferência e formato. */
export const MOTION_QUERIES = {
  motion: '(prefers-reduced-motion: no-preference)',
  reduced: '(prefers-reduced-motion: reduce)',
  desktop: '(min-width: 1024px)',
  mobile: '(max-width: 1023.98px)',
  finePointer: '(hover: hover) and (pointer: fine)',
} as const;

export type MotionConditions = Record<keyof typeof MOTION_QUERIES, boolean>;

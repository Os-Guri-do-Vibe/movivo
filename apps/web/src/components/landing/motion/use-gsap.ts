'use client';

import { useEffect, useRef, type RefObject } from 'react';

import { loadGsap, MOTION_QUERIES, type GsapApi, type MotionConditions } from './gsap';

export type MotionSetup = (
  api: GsapApi & { root: HTMLElement; conditions: MotionConditions },
) => void | (() => void);

/**
 * Executa um setup de GSAP escopado em `ref`, dentro de um `gsap.matchMedia()`.
 *
 * - O setup roda de novo quando preferência de movimento ou breakpoint mudam, e tudo o
 *   que ele criou (tweens, ScrollTriggers) é revertido antes — sem vazamento.
 * - Desmontar o componente reverte tudo (inline styles voltam ao estado do HTML).
 * - O setup mais recente é sempre o usado; ele não precisa ser estável.
 */
export function useGsap(ref: RefObject<HTMLElement | null>, setup: MotionSetup): void {
  const setupRef = useRef(setup);

  useEffect(() => {
    setupRef.current = setup;
  });

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let cancelled = false;
    let revert: (() => void) | undefined;

    void loadGsap().then((api) => {
      if (cancelled) return;
      const mm = api.gsap.matchMedia(root);
      mm.add(
        MOTION_QUERIES,
        (context) => {
          const conditions = context.conditions as MotionConditions;
          return setupRef.current({ ...api, root, conditions });
        },
        root,
      );
      revert = () => mm.revert();
    });

    return () => {
      cancelled = true;
      revert?.();
    };
  }, [ref]);
}

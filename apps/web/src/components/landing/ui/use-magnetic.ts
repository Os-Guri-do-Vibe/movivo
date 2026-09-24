'use client';

import { useEffect, type RefObject } from 'react';

import { MOTION_QUERIES } from '../motion/gsap';

const MAX_OFFSET = 5;

/**
 * Leve atração do botão pelo ponteiro (máx. 5px). Só com mouse/trackpad e sem
 * `prefers-reduced-motion`; em toque o hook não registra nada.
 */
export function useMagnetic(ref: RefObject<HTMLElement | null>, enabled = true): void {
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled || typeof window.matchMedia !== 'function') return;
    const fine = window.matchMedia(MOTION_QUERIES.finePointer);
    const motion = window.matchMedia(MOTION_QUERIES.motion);
    if (!fine.matches || !motion.matches) return;

    function move(event: PointerEvent) {
      if (!element) return;
      const rect = element.getBoundingClientRect();
      const x = (event.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
      const y = (event.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
      element.style.setProperty('--mx', `${(x * MAX_OFFSET).toFixed(2)}px`);
      element.style.setProperty('--my', `${(y * MAX_OFFSET * 0.6).toFixed(2)}px`);
    }

    function reset() {
      element?.style.setProperty('--mx', '0px');
      element?.style.setProperty('--my', '0px');
    }

    element.addEventListener('pointermove', move);
    element.addEventListener('pointerleave', reset);
    return () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerleave', reset);
      reset();
    };
  }, [ref, enabled]);
}

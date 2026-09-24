'use client';

import { useEffect, useState, type RefObject } from 'react';

/**
 * `true` a partir do momento em que o elemento chega perto da viewport (e não volta a
 * `false`). Usado para adiar downloads pesados — imagens anatômicas, WebGL — até que
 * a seção esteja realmente a caminho.
 */
export function useNearViewport(ref: RefObject<Element | null>, rootMargin = '600px 0px'): boolean {
  const [near, setNear] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || near) return;
    if (typeof IntersectionObserver !== 'function') {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, rootMargin, near]);

  return near;
}

'use client';

import { useRef, type ReactNode } from 'react';

import { SECTION_EFFECTS, type SectionEffect } from './effects';
import { useGsap } from './use-gsap';

type SectionMotionProps = {
  effect: SectionEffect;
  className?: string;
  children: ReactNode;
};

/**
 * Ponte entre seções renderizadas no servidor e seus efeitos GSAP. O conteúdo continua
 * RSC (zero JS de marcação); só o efeito — selecionado por nome — roda no cliente,
 * escopado nesta div e revertido ao desmontar ou quando a preferência de movimento muda.
 */
export function SectionMotion({ effect, className, children }: SectionMotionProps) {
  const ref = useRef<HTMLDivElement>(null);
  useGsap(ref, (api) => SECTION_EFFECTS[effect](api));
  return (
    <div ref={ref} className={className} data-motion={effect}>
      {children}
    </div>
  );
}

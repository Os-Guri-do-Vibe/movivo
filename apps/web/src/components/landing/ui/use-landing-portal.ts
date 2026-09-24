'use client';

import { useEffect, useState } from 'react';

export const LANDING_ROOT_SELECTOR = '[data-landing-root]';

/**
 * Container dos portais (menu, drawer) dentro da raiz da landing: os tokens e as
 * fontes são escopados nela, então um portal direto no `<body>` perderia a identidade.
 */
export function useLandingPortal(): HTMLElement | null {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setContainer(document.querySelector<HTMLElement>(LANDING_ROOT_SELECTOR));
  }, []);
  return container;
}

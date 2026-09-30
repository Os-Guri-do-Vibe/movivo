'use client';

import type { AnchorHTMLAttributes } from 'react';

import { trackLandingEvent, type LandingEvent } from '@/lib/landing/analytics';

type TrackedLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  event: LandingEvent;
};

/** Link comum que só acrescenta a medição do clique. Para o rodapé, que é Server Component. */
export function TrackedLink({ event, onClick, ...props }: TrackedLinkProps) {
  return (
    <a
      {...props}
      onClick={(e) => {
        onClick?.(e);
        trackLandingEvent(event);
      }}
    />
  );
}

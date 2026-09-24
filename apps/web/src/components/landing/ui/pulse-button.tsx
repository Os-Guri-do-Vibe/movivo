'use client';

import { useRef, type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';

import type { SubscriptionPlanId } from '@movivo/shared';

import { cn } from '@/lib/utils';
import {
  trackLandingEvent,
  type LandingCtaEvent,
  type LandingEvent,
} from '@/lib/landing/analytics';
import { selectPlan, useSelectedPlan } from '@/lib/landing/plan-selection';
import { anamnesisHref } from '@/lib/landing/pricing';
import { PRICING_HASH } from '@/lib/landing/site';

import styles from './button.module.css';
import { useMagnetic } from './use-magnetic';

type Variant = 'primary' | 'secondary';

type SharedProps = {
  children: ReactNode;
  variant?: Variant;
  size?: 'default' | 'compact';
  /** `block`: largura total só no mobile; `full`: sempre largura total. */
  width?: 'auto' | 'block' | 'full';
  /** Seções claras: borda e hover do secundário ajustados ao fundo Névoa. */
  onLight?: boolean;
  arrow?: boolean;
  magnetic?: boolean;
  className?: string;
};

export function buttonClassName({
  variant = 'primary',
  size = 'default',
  width = 'auto',
  onLight = false,
  className,
}: Omit<SharedProps, 'children' | 'arrow' | 'magnetic'>): string {
  return cn(
    styles.button,
    variant === 'primary' ? styles.primary : styles.secondary,
    size === 'compact' && styles.compact,
    width === 'block' && styles.block,
    width === 'full' && styles.fullWidth,
    onLight && styles.onLight,
    className,
  );
}

export function ArrowIcon() {
  return (
    <svg className={styles.arrow} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M4 10h11.5M11 5.5 15.5 10 11 14.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type PulseLinkProps = SharedProps & {
  href: string;
  event?: LandingEvent;
  /** `false` quando quem chama já rastreia o clique (com propriedades próprias). */
  trackClick?: boolean;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  ariaLabel?: string;
};

/** Link com a pele do Pulse Button. Rotas internas usam `next/link`; âncoras, `<a>`. */
export function PulseLink({
  href,
  event,
  trackClick = true,
  onClick,
  ariaLabel,
  children,
  arrow = true,
  magnetic = true,
  ...style
}: PulseLinkProps) {
  const ref = useRef<HTMLAnchorElement>(null);
  useMagnetic(ref, magnetic);

  function handleClick(clickEvent: MouseEvent<HTMLAnchorElement>) {
    if (event && trackClick) trackLandingEvent(event);
    onClick?.(clickEvent);
  }

  const content = (
    <>
      <span>{children}</span>
      {arrow ? <ArrowIcon /> : null}
    </>
  );
  const shared = {
    ref,
    className: buttonClassName(style),
    onClick: handleClick,
    'aria-label': ariaLabel,
    'data-analytics-event': event,
  };

  return href.startsWith('/') ? (
    <Link href={href} {...shared}>
      {content}
    </Link>
  ) : (
    <a href={href} {...shared}>
      {content}
    </a>
  );
}

type TrialCtaProps = SharedProps & {
  event: LandingCtaEvent;
  /** Plano fixo (cartões de preço). Sem ele, vale o plano escolhido nesta visita, se houver. */
  plan?: SubscriptionPlanId;
  /** Complemento só para leitor de tela (ex.: tradução de um rótulo em inglês). */
  srSuffix?: string;
  /** Rastreamento adicional do chamador (ex.: `pricing_select_*`). */
  onTrack?: () => void;
};

/**
 * CTA de início do trial. Preserva o fluxo existente: com plano → `/anamnese?plano=ID`
 * (a anamnese persiste o plano na sessão); sem plano → rola até os planos para a
 * escolha. `form_started` (evento de funil da US-1.5) só dispara quando o clique
 * realmente leva à anamnese.
 */
export function TrialCta({ event, plan, srSuffix, onTrack, children, ...rest }: TrialCtaProps) {
  const selected = useSelectedPlan();
  const target = plan ?? selected;

  function handleClick() {
    onTrack?.();
    trackLandingEvent(event, target ? { plan: target } : undefined);
    if (!target) return;
    selectPlan(target);
    trackLandingEvent('form_started', { plan: target });
  }

  return (
    <PulseLink
      href={target ? anamnesisHref(target) : PRICING_HASH}
      event={event}
      trackClick={false}
      onClick={handleClick}
      {...rest}
    >
      {children}
      {srSuffix ? <span className="sr-only">{srSuffix}</span> : null}
    </PulseLink>
  );
}

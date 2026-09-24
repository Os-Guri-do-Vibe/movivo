import type { CSSProperties, ReactNode } from 'react';
import Image from 'next/image';

import { cn } from '@/lib/utils';
import type { AssetPath } from '@/lib/landing/assets';

import styles from './media-slot.module.css';

export type MediaFallbackVariant = 'ambient' | 'portrait' | 'custom';

type MediaSlotProps = {
  /** Caminho vindo de `movivoAssets`. `null` → fallback visual. */
  asset: AssetPath;
  /** Proporção da moldura (ex.: `'4 / 5'`). Reserva o espaço: zero CLS com ou sem asset. */
  aspectRatio?: string;
  theme?: 'dark' | 'light';
  fallbackVariant?: MediaFallbackVariant;
  /** Composição própria da seção para quando o asset não existe. */
  fallback?: ReactNode;
  /** Monograma do fallback `portrait`. */
  monogram?: string;
  priority?: boolean;
  alt?: string;
  decorative?: boolean;
  sizes?: string;
  className?: string;
  style?: CSSProperties;
};

/**
 * Moldura de mídia com fallback premium. Quando o asset existir no registro, a imagem
 * entra no lugar da composição sem mudar o layout. O visitante nunca vê "placeholder",
 * ícone quebrado ou caixa cinza.
 */
export function MediaSlot({
  asset,
  aspectRatio,
  theme = 'dark',
  fallbackVariant = 'ambient',
  fallback,
  monogram,
  priority = false,
  alt = '',
  decorative = false,
  sizes = '(min-width: 1024px) 40vw, 100vw',
  className,
  style,
}: MediaSlotProps) {
  return (
    <div
      className={cn(styles.frame, theme === 'light' ? styles.light : styles.dark, className)}
      style={{ aspectRatio, ...style }}
      data-media-state={asset ? 'asset' : 'fallback'}
    >
      {asset ? (
        <Image
          src={asset}
          alt={decorative ? '' : alt}
          aria-hidden={decorative || undefined}
          fill
          sizes={sizes}
          priority={priority}
          className={styles.image}
        />
      ) : (
        <div className={styles.fallback} aria-hidden="true">
          {fallback ?? <DefaultFallback variant={fallbackVariant} monogram={monogram} />}
        </div>
      )}
    </div>
  );
}

function DefaultFallback({
  variant,
  monogram,
}: {
  variant: MediaFallbackVariant;
  monogram?: string;
}) {
  if (variant === 'portrait') {
    return (
      <div className={styles.portrait}>
        <span className={styles.portraitGlow} />
        <svg className={styles.portraitFigure} viewBox="0 0 200 250" fill="none">
          <defs>
            <linearGradient id="mv-portrait-fig" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="rgba(244,247,243,0.16)" />
              <stop offset="1" stopColor="rgba(244,247,243,0)" />
            </linearGradient>
          </defs>
          <circle cx="100" cy="86" r="34" fill="url(#mv-portrait-fig)" />
          <path d="M28 250c4-58 34-92 72-92s68 34 72 92" fill="url(#mv-portrait-fig)" />
        </svg>
        {monogram ? <span className={styles.monogram}>{monogram}</span> : null}
        <span className={styles.portraitPulse} />
        <span className={styles.grain} />
      </div>
    );
  }
  return (
    <div className={styles.ambient}>
      <span className={styles.ambientPulse} />
      <span className={styles.grain} />
    </div>
  );
}

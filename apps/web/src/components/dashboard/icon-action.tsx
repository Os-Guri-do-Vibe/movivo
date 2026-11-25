'use client';

/**
 * Botão só-ícone com dica (tooltip) que funciona nos três jeitos de usar o painel:
 * - mouse: aparece ao passar por cima;
 * - teclado: aparece no foco visível e some com `Esc` (WCAG 1.4.13, dispensável);
 * - toque: um toque longo mostra a dica sem disparar a ação (no toque curto, age direto).
 * O nome acessível é sempre o `label` (`aria-label`); `hint` é a frase extra, lida como descrição.
 * Alvo de 44px no toque e 40px em ponteiro fino (`ICON_BUTTON`).
 */
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type MouseEvent, type PointerEvent } from 'react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { ICON_BUTTON } from './control-center-table';

const LONG_PRESS_MS = 450;

/** Foco veio do teclado? Navegador sem `:focus-visible` trata todo foco como visível. */
function focusVisible(element: Element): boolean {
  try {
    return element.matches(':focus-visible');
  } catch {
    return true;
  }
}
const TOUCH_HINT_MS = 2_500;

export function IconAction({
  label,
  hint,
  icon: Icon,
  href,
  onClick,
  informational = false,
  className,
}: {
  /** Nome da ação ("Ver anamnese"). Vira o `aria-label` e a dica. */
  label: string;
  /** Frase complementar mostrada na dica e lida como descrição (ex.: o prazo completo). */
  hint?: string;
  icon: LucideIcon;
  /** Com `href`, é um link (navega); sem, um botão. */
  href?: string;
  onClick?: () => void;
  /**
   * Só informa (ex.: o relógio do prazo): o clique/toque abre e fecha a dica em vez de agir,
   * e o ícone fica em cinza para não competir com as ações.
   */
  informational?: boolean;
  className?: string;
}) {
  const tipId = useId();
  const [open, setOpen] = useState(false);
  const pressTimer = useRef<number | undefined>(undefined);
  const hideTimer = useRef<number | undefined>(undefined);
  const suppressClick = useRef(false);
  const lastPointer = useRef('mouse');

  useEffect(
    () => () => {
      window.clearTimeout(pressTimer.current);
      window.clearTimeout(hideTimer.current);
    },
    [],
  );

  const showFor = (ms: number) => {
    setOpen(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setOpen(false), ms);
  };

  const handlers = {
    onMouseEnter: () => setOpen(true),
    onMouseLeave: () => setOpen(false),
    onFocus: (event: { currentTarget: Element }) => {
      // Só no foco por teclado: no clique o foco também chega, e a dica ficaria presa.
      if (focusVisible(event.currentTarget)) setOpen(true);
    },
    onBlur: () => setOpen(false),
    onKeyDown: (event: { key: string }) => {
      if (event.key === 'Escape') setOpen(false);
    },
    onPointerDown: (event: PointerEvent) => {
      lastPointer.current = event.pointerType;
      if (event.pointerType !== 'touch') return;
      suppressClick.current = false;
      window.clearTimeout(pressTimer.current);
      pressTimer.current = window.setTimeout(() => {
        suppressClick.current = true;
        showFor(TOUCH_HINT_MS);
      }, LONG_PRESS_MS);
    },
    onPointerUp: () => window.clearTimeout(pressTimer.current),
    onPointerCancel: () => window.clearTimeout(pressTimer.current),
    // O toque longo não abre o menu de contexto do sistema (copiar link etc.) por cima da dica.
    onContextMenu: (event: MouseEvent) => {
      if (suppressClick.current) event.preventDefault();
    },
    onClick: (event: MouseEvent) => {
      if (suppressClick.current) {
        suppressClick.current = false;
        event.preventDefault();
        return;
      }
      if (informational) {
        // Clicar/tocar no relógio sempre MOSTRA o prazo (com o mouse ele já abriu no hover;
        // alternar aqui o fecharia no clique). No toque, some sozinho; `Esc` e sair fecham.
        event.preventDefault();
        if (lastPointer.current === 'touch') showFor(TOUCH_HINT_MS * 2);
        else setOpen(true);
        return;
      }
      onClick?.();
    },
  };

  const triggerClass = cn(
    buttonVariants({ variant: 'ghost', size: 'icon' }),
    ICON_BUTTON,
    informational && 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
    className,
  );
  const content = <Icon aria-hidden="true" />;
  const common = {
    'aria-label': label,
    'aria-describedby': hint ? tipId : undefined,
    className: triggerClass,
    ...handlers,
  };

  return (
    <span className="relative inline-flex">
      {href ? (
        <Link href={href} {...common}>
          {content}
        </Link>
      ) : (
        <button type="button" {...common} aria-expanded={informational ? open : undefined}>
          {content}
        </button>
      )}
      <span
        role="tooltip"
        // O nome já vem do `aria-label` e a descrição aponta só para `hint`: a dica visual inteira
        // fica fora da árvore de acessibilidade para não ser lida duas vezes.
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute right-0 bottom-full z-20 mb-2 w-max max-w-[min(18rem,calc(100vw-2rem))] rounded-md border border-border bg-popover px-3 py-1.5 text-xs leading-snug text-popover-foreground shadow-lg transition-opacity duration-150 motion-reduce:transition-none',
          open ? 'opacity-100' : 'invisible opacity-0',
        )}
      >
        {hint ? (
          <>
            <span className="font-medium">{label}</span>
            <span id={tipId} className="mt-0.5 block text-muted-foreground">
              {hint}
            </span>
          </>
        ) : (
          label
        )}
      </span>
    </span>
  );
}

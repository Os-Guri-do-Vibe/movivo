'use client';

/**
 * Mover uma sessão de dia na semana do protocolo, dos três jeitos: botões para o dia anterior e o
 * seguinte (toque e teclado), alça de arrastar (mouse; soltar sobre outro dia move, sobre outra
 * sessão troca os dias) e, na sessão aberta, a escolha direta do dia.
 */
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';

import { cn } from '@/lib/utils';

import { FOCUS_RING, ICON_BUTTON } from './control-center-table';

const BUTTON = cn(
  FOCUS_RING,
  ICON_BUTTON,
  'inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-30',
);

export function DayControls({
  id,
  name,
  dayIndex,
  dayCount,
  onMoveTo,
  onDragStart,
  onDragEnd,
}: {
  /** Prefixo dos ids dos botões: o foco volta para eles depois que a sessão muda de bloco. */
  id: string;
  /** Nome da sessão nos rótulos ("Força A"). */
  name: string;
  /** Posição do dia atual na lista de dias; `null` = ainda sem dia. */
  dayIndex: number | null;
  dayCount: number;
  onMoveTo: (dayIndex: number) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  return (
    <span className="inline-flex shrink-0 items-center">
      <button
        type="button"
        draggable
        aria-label={`Arrastar ${name} para outro dia`}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', name);
          onDragStart();
        }}
        onDragEnd={onDragEnd}
        className={cn(BUTTON, 'hidden cursor-grab active:cursor-grabbing pointer-fine:inline-flex')}
      >
        <GripVertical aria-hidden="true" className="size-4" />
      </button>
      <button
        id={`${id}-prev`}
        type="button"
        aria-label={`Mover ${name} para o dia anterior`}
        disabled={dayIndex === null || dayIndex === 0}
        onClick={() => dayIndex !== null && onMoveTo(dayIndex - 1)}
        className={BUTTON}
      >
        <ArrowUp aria-hidden="true" className="size-4" />
      </button>
      <button
        id={`${id}-next`}
        type="button"
        aria-label={`Mover ${name} para o próximo dia`}
        disabled={dayIndex === null || dayIndex === dayCount - 1}
        onClick={() => dayIndex !== null && onMoveTo(dayIndex + 1)}
        className={BUTTON}
      >
        <ArrowDown aria-hidden="true" className="size-4" />
      </button>
    </span>
  );
}

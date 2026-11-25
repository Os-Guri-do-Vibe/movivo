'use client';

/**
 * Reordenar uma lista (sessões do plano, exercícios da sessão) dos três jeitos:
 * - toque: botões ↑ e ↓ com alvo de 44px (arrastar no toque é impreciso e briga com a rolagem);
 * - mouse: arrastar pela alça (HTML5 nativo, sem dependência), visível só com ponteiro fino;
 * - teclado: ↑/↓ nos botões ou as setas do teclado com o foco na alça.
 * Cada movimento é anunciado pela região `aria-live` do editor e o foco segue o item movido.
 */
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { useId, useLayoutEffect, useRef, useState, type DragEvent } from 'react';

import { cn } from '@/lib/utils';

import { FOCUS_RING, ICON_BUTTON } from './control-center-table';

const BUTTON = cn(
  FOCUS_RING,
  ICON_BUTTON,
  'inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-30',
);

export function ReorderControls({
  name,
  index,
  count,
  onMove,
  dragHandle,
}: {
  /** Nome do item no rótulo dos botões ("Agachamento", "sessão Força A"). */
  name: string;
  index: number;
  count: number;
  onMove: (to: number) => void;
  /** Props da alça de arrastar (de `useDragReorder`); sem ela, só os botões. */
  dragHandle?: { onPointerDown: () => void };
}) {
  const hintId = useId();
  const upRef = useRef<HTMLButtonElement>(null);
  const downRef = useRef<HTMLButtonElement>(null);
  const gripRef = useRef<HTMLButtonElement>(null);
  const pending = useRef<'up' | 'down' | 'grip' | null>(null);

  // O item muda de lugar no DOM: o foco volta para o mesmo controle (ou o vizinho, no limite).
  useLayoutEffect(() => {
    const which = pending.current;
    if (!which) return;
    pending.current = null;
    const target =
      which === 'grip'
        ? gripRef
        : which === 'up'
          ? index === 0
            ? downRef
            : upRef
          : index === count - 1
            ? upRef
            : downRef;
    target.current?.focus();
  }, [index, count]);

  const move = (delta: number, from: 'up' | 'down' | 'grip') => {
    const to = index + delta;
    if (to < 0 || to >= count) return;
    pending.current = from;
    onMove(to);
  };

  if (count < 2) return null;

  return (
    <span className="inline-flex shrink-0 items-center">
      {dragHandle ? (
        <>
          <button
            ref={gripRef}
            type="button"
            aria-label={`Reordenar ${name} (posição ${index + 1} de ${count})`}
            aria-describedby={hintId}
            onPointerDown={dragHandle.onPointerDown}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                move(event.key === 'ArrowUp' ? -1 : 1, 'grip');
              }
            }}
            className={cn(
              BUTTON,
              'hidden cursor-grab active:cursor-grabbing pointer-fine:inline-flex',
            )}
          >
            <GripVertical aria-hidden="true" className="size-4" />
          </button>
          <span id={hintId} className="sr-only">
            Arraste com o mouse ou use as setas para cima e para baixo do teclado.
          </span>
        </>
      ) : null}
      <button
        ref={upRef}
        type="button"
        aria-label={`Subir ${name}`}
        disabled={index === 0}
        onClick={() => move(-1, 'up')}
        className={BUTTON}
      >
        <ArrowUp aria-hidden="true" className="size-4" />
      </button>
      <button
        ref={downRef}
        type="button"
        aria-label={`Descer ${name}`}
        disabled={index === count - 1}
        onClick={() => move(1, 'down')}
        className={BUTTON}
      >
        <ArrowDown aria-hidden="true" className="size-4" />
      </button>
    </span>
  );
}

/**
 * Arrastar e soltar nativo numa lista vertical. A linha só fica arrastável depois de pressionar a
 * alça (texto e campos da linha continuam selecionáveis); soltar sobre outra linha move para lá.
 */
export function useDragReorder(onMove: (from: number, to: number) => void) {
  const [armed, setArmed] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const reset = () => {
    setArmed(null);
    setDragging(null);
    setOver(null);
  };

  return {
    handle: (index: number) => ({ onPointerDown: () => setArmed(index) }),
    row: (index: number) => ({
      draggable: armed === index,
      'data-dragging': dragging === index ? '' : undefined,
      'data-drop-target':
        over === index && dragging !== null && dragging !== index ? '' : undefined,
      onDragStart: (event: DragEvent) => {
        // Só a linha armada pela própria alça; listas aninhadas (exercícios dentro da sessão)
        // não disparam a de fora.
        if (armed !== index) return;
        event.stopPropagation();
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(index));
        setDragging(index);
      },
      onDragOver: (event: DragEvent) => {
        if (dragging === null) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        if (over !== index) setOver(index);
      },
      onDrop: (event: DragEvent) => {
        if (dragging === null) return;
        event.preventDefault();
        event.stopPropagation();
        if (dragging !== index) onMove(dragging, index);
        reset();
      },
      onDragEnd: reset,
      onPointerUp: () => {
        if (dragging === null) setArmed(null);
      },
    }),
  };
}

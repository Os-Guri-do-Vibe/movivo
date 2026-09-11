import { cn } from '@/lib/utils';

const LABELS = ['Desempenho', 'Fadiga', 'Segurança', 'Resultado', 'Contexto'] as const;

/**
 * Barra de progresso do formulário de renovação — mesma estrutura visual de
 * `onboarding/progress-bar.tsx` (bolhas numeradas + sub-label), adaptada para os 5
 * blocos deste formulário em vez das 3 etapas do onboarding.
 */
export function ProgressBar({
  currentBlock,
  blockContext,
}: {
  currentBlock: 1 | 2 | 3 | 4 | 5;
  blockContext?: string;
}) {
  return (
    <div className="sticky top-0 z-20 -mx-5 flex flex-col gap-3 border-b border-border bg-white/95 px-5 pb-4 pt-2 backdrop-blur-sm sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pt-0 sm:backdrop-blur-none">
      <div
        className="relative"
        role="progressbar"
        aria-label="Progresso do formulário"
        aria-valuemin={1}
        aria-valuemax={5}
        aria-valuenow={currentBlock}
        aria-valuetext={
          blockContext
            ? `${blockContext}, bloco ${currentBlock} de 5`
            : `Bloco ${currentBlock} de 5`
        }
      >
        <div aria-hidden="true" className="absolute left-[10%] right-[10%] top-5 h-0.5 bg-border">
          <div
            className="h-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: `${((currentBlock - 1) / 4) * 100}%` }}
          />
        </div>
        <ol className="relative grid grid-cols-5">
          {LABELS.map((label, index) => {
            const block = (index + 1) as 1 | 2 | 3 | 4 | 5;
            const state =
              block < currentBlock ? 'done' : block === currentBlock ? 'current' : 'next';
            const stateLabel =
              state === 'done' ? 'Concluído' : state === 'current' ? 'Atual' : 'Próximo';

            return (
              <li
                key={label}
                aria-current={state === 'current' ? 'step' : undefined}
                aria-label={`Bloco ${block}: ${label}. ${stateLabel}`}
                className="flex min-w-0 flex-col items-center text-center"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-8 items-center justify-center rounded-full border-2 text-label font-bold sm:size-10 sm:text-body',
                    state === 'done' && 'border-primary bg-primary text-primary-foreground',
                    state === 'current' && 'border-petroleo bg-petroleo text-white',
                    state === 'next' && 'border-input bg-white text-muted-foreground',
                  )}
                >
                  {state === 'done' ? '✓' : block}
                </span>
                <span className="mt-2 hidden text-label font-semibold text-petroleo sm:block">
                  {label}
                </span>
                <span className="hidden text-[0.6875rem] text-muted-foreground sm:block">
                  {stateLabel}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      {blockContext && (
        <p className="font-mono text-[0.75rem] text-muted-foreground">{blockContext}</p>
      )}
    </div>
  );
}

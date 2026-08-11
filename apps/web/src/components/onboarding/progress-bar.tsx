import { cn } from '@/lib/utils';

const LABELS = ['Você', 'Sua rotina', 'Saúde'] as const;

export function ProgressBar({
  currentStep,
  step2Section = 0,
  step3Context,
}: {
  currentStep: 1 | 2 | 3;
  step2Section?: number;
  step3Context?: string;
}) {
  const context =
    currentStep === 2
      ? `Parte ${step2Section + 1} de 5`
      : currentStep === 3 && step3Context
        ? step3Context
        : null;

  return (
    <div className="sticky top-0 z-20 -mx-5 flex flex-col gap-3 border-b border-border bg-white/95 px-5 pb-4 pt-2 backdrop-blur-sm sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pt-0 sm:backdrop-blur-none">
      <div
        className="relative"
        role="progressbar"
        aria-label="Progresso do cadastro"
        aria-valuemin={1}
        aria-valuemax={3}
        aria-valuenow={currentStep}
        aria-valuetext={
          context ? `${context}, etapa ${currentStep} de 3` : 'Você, passo atual 1 de 3'
        }
      >
        <div aria-hidden="true" className="absolute left-1/6 right-1/6 top-5 h-0.5 bg-border">
          <div
            className="h-full bg-primary transition-[width] duration-300 ease-out"
            style={{ width: `${(currentStep - 1) * 50}%` }}
          />
        </div>
        <ol className="relative grid grid-cols-3">
          {LABELS.map((label, index) => {
            const step = (index + 1) as 1 | 2 | 3;
            const state = step < currentStep ? 'done' : step === currentStep ? 'current' : 'next';
            const stateLabel =
              state === 'done' ? 'Concluída' : state === 'current' ? 'Atual' : 'Próxima';

            return (
              <li
                key={label}
                aria-current={state === 'current' ? 'step' : undefined}
                aria-label={`Etapa ${step}: ${label}. ${stateLabel}`}
                className="flex min-w-0 flex-col items-center text-center"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-10 items-center justify-center rounded-full border-2 text-body font-bold',
                    state === 'done' && 'border-primary bg-primary text-primary-foreground',
                    state === 'current' && 'border-petroleo bg-petroleo text-white',
                    state === 'next' && 'border-input bg-white text-muted-foreground',
                  )}
                >
                  {state === 'done' ? '✓' : step}
                </span>
                <span className="mt-2 text-label font-semibold text-petroleo">{label}</span>
                <span className="text-[0.6875rem] text-muted-foreground">{stateLabel}</span>
              </li>
            );
          })}
        </ol>
      </div>
      {context && <p className="font-mono text-[0.75rem] text-muted-foreground">{context}</p>}
    </div>
  );
}

import { cn } from '@/lib/utils';

export const STEP_LABELS = [
  'Você',
  'Objetivo',
  'Treino',
  'Semana',
  'Preferências',
  'Dores',
  'Alimentação',
  'Corpo',
  'Segurança',
] as const;

/**
 * Progresso das 9 etapas: uma faixa segmentada (cada segmento é uma etapa) e o nome da etapa
 * atual. Etapas já salvas ficam cheias, inclusive as que o aluno pulou e voltou.
 */
export function ProgressBar({
  currentStep,
  completedSteps,
  firstStep = 1,
  context,
}: {
  currentStep: number;
  completedSteps: readonly number[];
  /** Na anamnese complementar o cadastro (etapa 1) não existe: a contagem começa na 2. */
  firstStep?: number;
  context?: string;
}) {
  const steps = STEP_LABELS.map((label, index) => ({ label, number: index + 1 })).filter(
    (step) => step.number >= firstStep,
  );
  const position = steps.findIndex((step) => step.number === currentStep) + 1;
  const label = STEP_LABELS[currentStep - 1];

  return (
    <div className="sticky top-0 z-20 -mx-5 flex flex-col gap-2.5 border-b border-border bg-white/95 px-5 pb-3 pt-2 backdrop-blur-sm sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:px-0 sm:pt-0 sm:backdrop-blur-none">
      <p className="flex items-baseline justify-between gap-3 text-label">
        <span className="font-semibold text-petroleo">
          Etapa {position} de {steps.length} · {label}
        </span>
        {context && (
          <span className="font-mono text-[0.75rem] tabular-nums text-muted-foreground">
            {context}
          </span>
        )}
      </p>
      <div
        role="progressbar"
        aria-label="Progresso do cadastro"
        aria-valuemin={1}
        aria-valuemax={steps.length}
        aria-valuenow={position}
        aria-valuetext={`Etapa ${position} de ${steps.length}: ${label}`}
      >
        <ol className="flex gap-1">
          {steps.map((step) => {
            const done = completedSteps.includes(step.number) && step.number !== currentStep;
            const current = step.number === currentStep;
            return (
              <li
                key={step.number}
                aria-current={current ? 'step' : undefined}
                aria-label={`Etapa ${step.number}: ${step.label}${done ? ', concluída' : current ? ', atual' : ''}`}
                className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-border"
              >
                {/* O preenchimento cresce da esquerda quando a etapa vira atual ou concluída. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute inset-0 origin-left rounded-full transition-[transform,background-color] duration-500 ease-out',
                    done && 'scale-x-100 bg-primary',
                    current && 'scale-x-100 bg-petroleo',
                    !done && !current && 'scale-x-0 bg-primary',
                  )}
                />
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

import { cn } from '@/lib/utils';

/**
 * Barra de progresso (Sofia §1): 3 rótulos macro sempre visíveis. Nunca chega a 100%
 * antes do FINALIZAR — o segmento da etapa atual fica parcialmente preenchido, não
 * cheio, para não prometer "quase lá" antes da hora.
 */
const LABELS = ['Você', 'Sua rotina de treino', 'Saúde'] as const;

export function ProgressBar({ currentStep }: { currentStep: 1 | 2 | 3 }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={currentStep}>
        {LABELS.map((_, i) => {
          const step = (i + 1) as 1 | 2 | 3;
          const state = step < currentStep ? 'done' : step === currentStep ? 'current' : 'upcoming';
          return (
            <div key={step} className="h-1.5 flex-1 overflow-hidden rounded-full bg-accent">
              <div
                className={cn(
                  'h-full rounded-full bg-primary transition-all',
                  state === 'done' && 'w-full',
                  state === 'current' && 'w-1/2',
                  state === 'upcoming' && 'w-0',
                )}
              />
            </div>
          );
        })}
      </div>
      <p className="text-label text-muted-foreground">
        Etapa {currentStep} de 3 — {LABELS[currentStep - 1]}
      </p>
    </div>
  );
}

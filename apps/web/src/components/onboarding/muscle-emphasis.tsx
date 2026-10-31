'use client';

import { MUSCLE_EMPHASIS_LABELS, type MuscleEmphasisRegion } from '@movivo/shared';

import { cn } from '@/lib/utils';

import { QuestionMeta, selectionHint } from './fields';

const REGIONS = Object.keys(MUSCLE_EMPHASIS_LABELS) as MuscleEmphasisRegion[];
const MAX_REGIONS = 2;

/** Ícones do Icons8 (liberados na CSP só na rota da anamnese). */
const ICON_URLS: Readonly<Record<MuscleEmphasisRegion, string>> = {
  CHEST: 'https://img.icons8.com/color/100/chest.png',
  BACK: 'https://img.icons8.com/color/100/back-muscles.png',
  SHOULDERS: 'https://img.icons8.com/color/100/shoulders.png',
  ARMS: 'https://img.icons8.com/color/100/muscle-flexing.png',
  ABS_CORE: 'https://img.icons8.com/color/100/torso.png',
  QUADS: 'https://img.icons8.com/color/100/quadriceps.png',
  HAMSTRINGS: 'https://img.icons8.com/color/100/hamstrings.png',
  GLUTES: 'https://img.icons8.com/color/100/glutes.png',
  CALVES: 'https://img.icons8.com/color/100/calves.png',
};

/** Regiões em que o aluno de musculação quer mais ênfase (até 2), com o ícone de cada uma. */
export function MuscleEmphasisGrid({
  selected,
  onToggle,
}: {
  selected: readonly MuscleEmphasisRegion[];
  onToggle: (region: MuscleEmphasisRegion) => void;
}) {
  const atLimit = selected.length >= MAX_REGIONS;
  return (
    <fieldset className="min-w-0">
      <legend className="text-body font-semibold text-foreground">
        Em quais regiões você gostaria de dar mais ênfase?
      </legend>
      <div className="mt-0.5" aria-live="polite">
        <QuestionMeta optional hint={selectionHint(true, MAX_REGIONS, selected.length)} />
      </div>
      <div className="mt-2 grid w-full grid-cols-3 gap-3">
        {REGIONS.map((region) => {
          const isSelected = selected.includes(region);
          const isDisabled = !isSelected && atLimit;
          return (
            <button
              key={region}
              type="button"
              aria-pressed={isSelected}
              aria-disabled={isDisabled || undefined}
              onClick={() => !isDisabled && onToggle(region)}
              className={cn(
                'relative flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-2xl border p-2 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-white sm:gap-2 sm:p-3',
                isSelected
                  ? 'border-petroleo bg-accent text-petroleo ring-1 ring-inset ring-petroleo'
                  : 'border-input bg-white text-foreground hover:border-petroleo hover:bg-secondary',
                isDisabled && 'opacity-50',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'absolute left-1.5 top-1.5 flex size-5 items-center justify-center rounded-full border text-[0.6875rem] font-bold sm:left-2 sm:top-2 sm:size-6 sm:text-label',
                  isSelected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input text-transparent',
                )}
              >
                ✓
              </span>
              <span
                aria-hidden="true"
                data-icons8-icon={region}
                className="size-10 shrink-0 bg-contain bg-center bg-no-repeat sm:size-16"
                style={{ backgroundImage: `url(${ICON_URLS[region]})` }}
              />
              <span className="text-center text-xs font-semibold leading-4 sm:text-label">
                {MUSCLE_EMPHASIS_LABELS[region]}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

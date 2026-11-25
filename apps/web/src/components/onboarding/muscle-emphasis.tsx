'use client';

import { MUSCLE_EMPHASIS_LABELS, type MuscleEmphasisRegion } from '@movivo/shared';

import { cn } from '@/lib/utils';

import { QuestionMeta, SelectionIndicator, selectionHint } from './fields';

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
      <legend className="text-body font-semibold leading-snug tracking-[-0.005em] text-foreground">
        Na musculação, quer dar mais ênfase a alguma região do corpo?
      </legend>
      <div className="mt-0.5" aria-live="polite">
        <QuestionMeta optional hint={selectionHint(true, MAX_REGIONS, selected.length)} />
      </div>
      <div className="mt-3 grid w-full grid-cols-3 gap-2.5">
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
                'relative flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-2xl border p-2 text-center outline-none sm:gap-2 sm:p-3',
                'transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out',
                'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-white',
                isSelected
                  ? 'border-petroleo bg-accent text-petroleo shadow-[inset_0_0_0_1px_var(--petroleo-vivo)]'
                  : 'border-border bg-white text-foreground shadow-[0_1px_2px_rgba(6,48,42,0.05)] hover:border-input hover:bg-nevoa',
                isDisabled
                  ? 'cursor-not-allowed opacity-50 hover:border-border hover:bg-white'
                  : 'motion-safe:active:scale-[0.97]',
              )}
            >
              <SelectionIndicator selected={isSelected} multi className="absolute left-2 top-2" />
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

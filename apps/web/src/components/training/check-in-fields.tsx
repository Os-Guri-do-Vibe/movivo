'use client';

import type { DailyCheckIn } from '@movivo/shared';

const NUTRITION: ReadonlyArray<{ value: NonNullable<DailyCheckIn['nutrition']>; label: string }> = [
  { value: 'ON_TRACK', label: 'Segui o plano' },
  { value: 'PARTIAL', label: 'Mais ou menos' },
  { value: 'OFF', label: 'Fugi do plano' },
];

/** Escala de 1 a 5 em um toque: o aluno responde em segundos e os agentes ganham o dia dele. */
export function Scale({
  legend,
  hint,
  value,
  onChange,
}: {
  legend: string;
  hint: string;
  value: number | null;
  onChange: (value: number) => void;
}) {
  return (
    <fieldset>
      <legend className="text-label font-semibold">
        {legend} <span className="font-normal text-muted-foreground">({hint})</span>
      </legend>
      <div className="mt-2 flex gap-2" role="radiogroup" aria-label={legend}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            onClick={() => onChange(n)}
            className={`size-10 rounded-lg border text-label font-semibold ${value === n ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card'}`}
          >
            {n}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export const EMPTY_CHECK_IN: DailyCheckIn = {
  energy: null,
  sleep: null,
  soreness: null,
  mood: null,
  stress: null,
  nutrition: null,
};

/** As perguntas do dia, iguais no fechamento do treino e no dia de descanso. */
export function CheckInFields({
  value,
  onChange,
}: {
  value: DailyCheckIn;
  onChange: (value: DailyCheckIn) => void;
}) {
  const set = <K extends keyof DailyCheckIn>(key: K, next: DailyCheckIn[K]) =>
    onChange({ ...value, [key]: next });
  return (
    <>
      <Scale
        legend="Disposição"
        hint="1 = sem energia, 5 = ótima"
        value={value.energy ?? null}
        onChange={(n) => set('energy', n)}
      />
      <Scale
        legend="Sono da noite passada"
        hint="1 = péssimo, 5 = ótimo"
        value={value.sleep ?? null}
        onChange={(n) => set('sleep', n)}
      />
      <Scale
        legend="Corpo"
        hint="1 = muito dolorido, 5 = sem dor muscular"
        value={value.soreness ?? null}
        onChange={(n) => set('soreness', n)}
      />
      <Scale
        legend="Ânimo"
        hint="1 = sem vontade, 5 = animado"
        value={value.mood ?? null}
        onChange={(n) => set('mood', n)}
      />
      <Scale
        legend="Estresse"
        hint="1 = tranquilo, 5 = muito estressado"
        value={value.stress ?? null}
        onChange={(n) => set('stress', n)}
      />
      <fieldset>
        <legend className="text-label font-semibold">Alimentação de hoje</legend>
        <div
          className="mt-2 flex flex-wrap gap-2"
          role="radiogroup"
          aria-label="Alimentação de hoje"
        >
          {NUTRITION.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={value.nutrition === option.value}
              onClick={() => set('nutrition', option.value)}
              className={`rounded-lg border px-3 py-2 text-label ${value.nutrition === option.value ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>
    </>
  );
}

'use client';

import { type DaySlot, type Weekday } from '@movivo/shared';

import { ChoiceGroup, TextInput, YesNo } from './fields';
import { WEEKDAY_ITEMS } from './legacy-anamnesis-items';
import { routineComplete, type RoutineDraft } from './onboarding-drafts';
import { Labeled, StepFrame } from './step-frame';

const SLOT_ITEMS: { value: DaySlot; label: string }[] = [
  { value: 'MORNING', label: 'Manhã' },
  { value: 'AFTERNOON', label: 'Tarde' },
  { value: 'EVENING', label: 'Noite' },
  { value: 'ANY', label: 'Qualquer horário' },
];

const OCCUPATION_ITEMS: { value: RoutineDraft['occupationRhythm']; label: string }[] = [
  { value: 'REGULAR', label: 'Horários regulares' },
  { value: 'SHIFTS', label: 'Trabalho em turnos' },
  { value: 'TRAVELS_OFTEN', label: 'Viajo com frequência' },
  { value: 'IRREGULAR', label: 'Rotina imprevisível' },
];

const COOKING_ITEMS: { value: RoutineDraft['cookingCapacity']; label: string }[] = [
  { value: 'NONE', label: 'Não cozinho' },
  { value: 'BASIC', label: 'Cozinho o básico' },
  { value: 'GOOD', label: 'Cozinho bem' },
];

const BUDGET_ITEMS: { value: RoutineDraft['foodBudget']; label: string }[] = [
  { value: 'TIGHT', label: 'Apertado' },
  { value: 'MODERATE', label: 'Moderado' },
  { value: 'COMFORTABLE', label: 'Confortável' },
];

const STRESS_ITEMS = [
  { value: 'LOW', label: 'Baixo' },
  { value: 'MODERATE', label: 'Médio' },
  { value: 'HIGH', label: 'Alto' },
];

export function StepRoutine({
  data,
  onChange,
  onContinue,
  onBack,
  saving,
}: {
  data: RoutineDraft;
  onChange: (data: RoutineDraft) => void;
  onContinue: () => void;
  onBack?: () => void;
  saving: boolean;
}) {
  const chosen = WEEKDAY_ITEMS.filter((day) => data.days[day.value].on);
  const setDay = (day: Weekday, patch: Partial<RoutineDraft['days'][Weekday]>) =>
    onChange({ ...data, days: { ...data.days, [day]: { ...data.days[day], ...patch } } });

  return (
    <StepFrame
      title="Como é a sua semana?"
      description="Você só informa quando pode. A MOVIVO monta e reorganiza a agenda sozinha, sempre que a sua semana mudar."
      canContinue={routineComplete(data)}
      saving={saving}
      onContinue={onContinue}
      onBack={onBack}
    >
      <ChoiceGroup
        legend="Em quais dias você consegue treinar?"
        items={WEEKDAY_ITEMS}
        selected={chosen.map((d) => d.value)}
        multi
        columns
        onToggle={(day) => setDay(day, { on: !data.days[day].on })}
      />
      {chosen.map((day) => (
        <div key={day.value} className="flex flex-col gap-3 rounded-xl border border-border p-4">
          <p className="text-body font-semibold">{day.label}</p>
          <ChoiceGroup
            legend="Quando?"
            items={SLOT_ITEMS}
            selected={[data.days[day.value].slot]}
            onToggle={(slot) => setDay(day.value, { slot })}
          />
          <Labeled id={`minutes-${day.value}`} label="Quanto tempo você tem (minutos)?">
            <TextInput
              id={`minutes-${day.value}`}
              inputMode="numeric"
              value={data.days[day.value].minutes}
              onChange={(minutes) => setDay(day.value, { minutes })}
            />
          </Labeled>
        </div>
      ))}
      <YesNo
        legend="Seus dias mudam de uma semana para outra?"
        value={data.variesWeekly}
        onChange={(variesWeekly) => onChange({ ...data, variesWeekly })}
      />
      <Labeled
        id="max-sessions"
        label="Quantas sessões por semana você consegue sustentar?"
        help="Pense numa semana normal, não na semana ideal."
      >
        <TextInput
          id="max-sessions"
          inputMode="numeric"
          value={data.maxSessions}
          onChange={(maxSessions) => onChange({ ...data, maxSessions })}
        />
      </Labeled>

      <ChoiceGroup
        legend="Como é o seu trabalho?"
        items={OCCUPATION_ITEMS}
        selected={[data.occupationRhythm]}
        onToggle={(occupationRhythm) => onChange({ ...data, occupationRhythm })}
      />
      <ChoiceGroup
        legend="Sobre cozinhar"
        items={COOKING_ITEMS}
        selected={[data.cookingCapacity]}
        onToggle={(cookingCapacity) => onChange({ ...data, cookingCapacity })}
      />
      <Labeled id="meals-out" label="Quantas refeições por semana você faz fora de casa?">
        <TextInput
          id="meals-out"
          inputMode="numeric"
          value={data.mealsOutsideHomePerWeek}
          onChange={(mealsOutsideHomePerWeek) => onChange({ ...data, mealsOutsideHomePerWeek })}
        />
      </Labeled>
      <ChoiceGroup
        legend="Orçamento para alimentação"
        items={BUDGET_ITEMS}
        selected={[data.foodBudget]}
        onToggle={(foodBudget) => onChange({ ...data, foodBudget })}
      />
      <Labeled id="sleep" label="Quantas horas você costuma dormir?" help="Opcional.">
        <TextInput
          id="sleep"
          inputMode="decimal"
          value={data.sleepHours}
          onChange={(sleepHours) => onChange({ ...data, sleepHours })}
        />
      </Labeled>
      <ChoiceGroup
        legend="Seu nível de estresse hoje (opcional)"
        items={STRESS_ITEMS}
        selected={data.stress ? [data.stress] : []}
        onToggle={(stress) => onChange({ ...data, stress: stress as RoutineDraft['stress'] })}
      />
    </StepFrame>
  );
}

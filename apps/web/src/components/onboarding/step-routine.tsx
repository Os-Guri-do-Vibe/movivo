'use client';

import {
  EXTERNAL_SPORT_LABELS,
  type DaySlot,
  type ExternalSport,
  type Weekday,
} from '@movivo/shared';

import {
  ChoiceGroup,
  ClockInput,
  Combobox,
  FieldError,
  FieldLabel,
  FieldValidation,
  QuestionField,
  YesNo,
} from './fields';
import {
  AVAILABLE_MINUTES_OPTIONS,
  dayWindow,
  routineComplete,
  sessionsExceedDays,
  sleepError,
  type CoachedModalityKey,
  type DayWindowDraft,
  type RoutineDraft,
} from './onboarding-drafts';
import { StepFrame } from './step-frame';
import { MODALITY_NAME } from './step-modalities';
import { WEEKDAY_ITEMS } from './weekday-items';

const LIST = new Intl.ListFormat('pt-BR', { type: 'conjunction' });

const SLOT_ITEMS: { value: DaySlot; label: string }[] = [
  { value: 'MORNING', label: 'Manhã' },
  { value: 'AFTERNOON', label: 'Tarde' },
  { value: 'EVENING', label: 'Noite' },
  { value: 'ANY', label: 'Varia conforme o dia' },
];

const AVAILABLE_LABELS: Record<(typeof AVAILABLE_MINUTES_OPTIONS)[number], string> = {
  '30': 'Até 30 minutos',
  '45': 'Aproximadamente 45 minutos',
  '60': 'Aproximadamente 60 minutos',
  '90': 'Mais de 60 minutos',
};
const AVAILABLE_ITEMS = AVAILABLE_MINUTES_OPTIONS.map((value) => ({
  value,
  label: AVAILABLE_LABELS[value],
}));

const STRESS_ITEMS = [
  { value: 'LOW', label: 'Baixo', description: 'Dias tranquilos, consigo relaxar com facilidade.' },
  {
    value: 'MODERATE',
    label: 'Moderado',
    description: 'Tenho momentos de tensão, mas dou conta da rotina.',
  },
  {
    value: 'HIGH',
    label: 'Alto',
    description: 'Me sinto sobrecarregado(a) com frequência.',
  },
] as const;

export function StepRoutine({
  data,
  modalities,
  externalSports,
  onChange,
  onContinue,
  onBack,
  saving,
}: {
  data: RoutineDraft;
  /** Modalidades escolhidas na etapa 3 (só para o texto da etapa). */
  modalities: readonly CoachedModalityKey[];
  /** Esportes externos da etapa 3: já ocupam a semana e não contam nos treinos da MOVIVO. */
  externalSports: readonly ExternalSport[];
  onChange: (data: RoutineDraft) => void;
  onContinue: () => void;
  onBack?: () => void;
  saving: boolean;
}) {
  /** Liga/desliga o dia e mantém a lista na ordem da semana. */
  const toggleDay = (day: Weekday) => {
    const next = data.days.includes(day) ? data.days.filter((d) => d !== day) : [...data.days, day];
    const overrides = { ...data.overrides };
    delete overrides[day];
    onChange({
      ...data,
      days: WEEKDAY_ITEMS.map((item) => item.value).filter((value) => next.includes(value)),
      // Com menos de 2 dias não há "dia diferente": a pergunta some e as diferenças também.
      ...(next.length < 2 ? { hasDayOverrides: undefined, overrides: {} } : { overrides }),
    });
  };

  const setDay = (day: Weekday, change: Partial<DayWindowDraft>) => {
    const current = dayWindow(data, day);
    onChange({
      ...data,
      overrides: {
        ...data.overrides,
        [day]: { slot: current.slot ?? 'ANY', minutes: current.minutes, ...change },
      },
    });
  };

  const markedDays = WEEKDAY_ITEMS.filter((item) => data.days.includes(item.value));
  const wanted = Number(data.daysWanted);
  const exceeded = sessionsExceedDays(data);
  const sessionItems = [
    ...markedDays.map((_, index) => index + 1),
    ...(exceeded && data.days.length > 0 ? [wanted] : []),
  ].map((count) => ({
    value: String(count),
    label: `${count} ${count === 1 ? 'treino' : 'treinos'}`,
  }));
  const trained = LIST.format(modalities.map((key) => MODALITY_NAME[key])) || 'os treinos';
  const sports = LIST.format(
    externalSports.map((sport) =>
      sport === 'OTHER' ? 'outro esporte' : EXTERNAL_SPORT_LABELS[sport].toLowerCase(),
    ),
  );

  return (
    <StepFrame
      title="Como é a sua semana?"
      description={`Conte quando você pode treinar. A MOVIVO distribui ${trained} nesses dias e reorganiza quando a sua semana mudar.`}
      canContinue={routineComplete(data)}
      saving={saving}
      onContinue={onContinue}
      onBack={onBack}
    >
      <Combobox
        id="available-days"
        legend="Em quais dias você pode treinar?"
        items={WEEKDAY_ITEMS}
        multiple
        value={data.days}
        onChange={toggleDay}
        placeholder="Selecione os dias"
      />
      <ChoiceGroup
        legend="Em qual período, na maioria desses dias?"
        items={SLOT_ITEMS}
        selected={data.slot ? [data.slot] : []}
        onToggle={(slot) => onChange({ ...data, slot })}
      />
      <ChoiceGroup
        legend="Quanto tempo você tem por treino, na maioria desses dias?"
        items={AVAILABLE_ITEMS}
        selected={data.availableMinutes ? [data.availableMinutes] : []}
        onToggle={(availableMinutes) => onChange({ ...data, availableMinutes })}
        layout="stack"
      />
      {data.days.length > 1 && (
        <YesNo
          legend="Algum desses dias tem período ou tempo diferente?"
          value={data.hasDayOverrides}
          onChange={(hasDayOverrides) =>
            onChange({
              ...data,
              hasDayOverrides,
              overrides: hasDayOverrides ? data.overrides : {},
            })
          }
          optional
        />
      )}
      {data.days.length > 1 && data.hasDayOverrides && (
        <div className="flex flex-col gap-3">
          {markedDays.map(({ value: day, label }) => {
            const window = dayWindow(data, day);
            const inDay = (
              <span className="sr-only">
                {`${day === 'SAT' || day === 'SUN' ? 'no' : 'na'} ${label.toLowerCase()}`}
              </span>
            );
            return (
              <div key={day} className="flex flex-col gap-4 rounded-xl border border-border p-4">
                <p aria-hidden="true" className="text-body font-semibold text-petroleo">
                  {label}
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Combobox
                    id={`slot-${day}`}
                    legend={<>Período {inDay}</>}
                    items={SLOT_ITEMS}
                    value={window.slot}
                    onChange={(slot) => setDay(day, { slot })}
                  />
                  <Combobox
                    id={`minutes-${day}`}
                    legend={<>Tempo {inDay}</>}
                    items={AVAILABLE_ITEMS}
                    value={window.minutes || null}
                    onChange={(minutes) => setDay(day, { minutes })}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Combobox
          id="sessions-wanted"
          legend="Quantos treinos da MOVIVO por semana você quer fazer?"
          help={
            sports
              ? `Sem contar ${sports}: eles já estão na sua semana e a MOVIVO organiza os treinos em volta deles.`
              : undefined
          }
          items={sessionItems}
          value={data.daysWanted || null}
          onChange={(daysWanted) => onChange({ ...data, daysWanted })}
          placeholder={
            data.days.length === 0 ? 'Marque os dias primeiro' : 'Selecione a quantidade de treinos'
          }
          disabled={data.days.length === 0}
        />
        <FieldError
          message={
            exceeded && data.days.length > 0
              ? `Você escolheu ${wanted} treinos, mas marcou só ${data.days.length} ${data.days.length === 1 ? 'dia' : 'dias'}. Ajuste um dos dois.`
              : undefined
          }
        />
      </div>
      <YesNo
        legend="Sua rotina muda de uma semana para outra?"
        value={data.variesWeekly}
        onChange={(variesWeekly) => onChange({ ...data, variesWeekly })}
      />
      <QuestionField>
        <FieldLabel htmlFor="sleep" optional>
          Quantas horas você costuma dormir?
        </FieldLabel>
        <FieldValidation error={sleepError(data.sleep)}>
          <ClockInput
            id="sleep"
            kind="sleep"
            placeholder="hh:mm"
            value={data.sleep}
            onChange={(sleep) => onChange({ ...data, sleep })}
          />
        </FieldValidation>
      </QuestionField>
      <Combobox
        id="stress"
        legend="Qual o seu nível de estresse no cotidiano?"
        items={STRESS_ITEMS}
        value={data.stress || null}
        onChange={(stress) => onChange({ ...data, stress })}
        placeholder="Selecione o seu nível"
        optional
      />
    </StepFrame>
  );
}

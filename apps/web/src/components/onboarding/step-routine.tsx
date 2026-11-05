'use client';

import type { DaySlot, Weekday } from '@movivo/shared';

import { ExternalSports } from './external-sports';
import {
  ChoiceGroup,
  ClockInput,
  Combobox,
  FieldHelp,
  FieldLabel,
  FieldValidation,
  QuestionField,
  QuestionSection,
  YesNo,
} from './fields';
import {
  AVAILABLE_MINUTES_OPTIONS,
  dayWindow,
  routineComplete,
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
  '45': 'Cerca de 45 minutos',
  '60': 'Cerca de 1 hora',
  '90': 'Mais de 1 hora',
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

/**
 * Etapa 4, "Sua semana". A ordem vai do que já está decidido ao que é preferência: o esporte
 * que o aluno já pratica, quando ele pode treinar, o teto de treinos que topa e, por último,
 * sono e estresse. Nada aqui monta o plano: quantos treinos, quais e em que dias quem decide
 * é a MOVIVO.
 */
export function StepRoutine({
  data,
  modalities,
  onChange,
  onContinue,
  onBack,
  saving,
}: {
  data: RoutineDraft;
  /** Modalidades escolhidas na etapa 3 (só para o texto da etapa). */
  modalities: readonly CoachedModalityKey[];
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
  const trained = LIST.format(modalities.map((key) => MODALITY_NAME[key]));
  return (
    <StepFrame
      title="Sua semana"
      description={`Conte como a sua semana é hoje. Com isso, a MOVIVO decide quantos treinos${trained ? ` de ${trained}` : ''} fazem sentido e em que dias, e explica o porquê.`}
      canContinue={routineComplete(data)}
      saving={saving}
      onContinue={onContinue}
      onBack={onBack}
    >
      <QuestionSection
        title="O que já ocupa a sua semana"
        description="Esporte que você já pratica também cansa. A MOVIVO organiza os treinos em volta dele."
      >
        <ExternalSports value={data} onChange={(next) => onChange({ ...data, ...next })} />
      </QuestionSection>

      <QuestionSection
        title="Quando você pode treinar"
        description="É daqui que a MOVIVO escolhe os dias e o tamanho de cada treino."
      >
        <Combobox
          id="available-days"
          legend="Em quais dias você pode treinar?"
          help="Marque todos os dias em que daria para treinar, mesmo que você não vá treinar em todos."
          items={WEEKDAY_ITEMS}
          multiple
          value={data.days}
          onChange={toggleDay}
          placeholder="Selecione os dias"
        />
        <ChoiceGroup
          legend="Na maioria desses dias, qual período fica melhor para treinar?"
          items={SLOT_ITEMS}
          selected={data.slot ? [data.slot] : []}
          onToggle={(slot) => onChange({ ...data, slot })}
        />
        <ChoiceGroup
          legend="E quanto tempo você tem para cada treino?"
          help="Conte só o treino, sem o deslocamento."
          items={AVAILABLE_ITEMS}
          selected={data.availableMinutes ? [data.availableMinutes] : []}
          onToggle={(availableMinutes) => onChange({ ...data, availableMinutes })}
          layout="stack"
        />
        {data.days.length > 1 && (
          <YesNo
            legend="Algum dia foge desse padrão de período ou de tempo?"
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
                      legend={<>Tempo disponível {inDay}</>}
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
        <YesNo
          legend="Esses dias e horários mudam de uma semana para outra, por escala, plantão ou viagem?"
          value={data.variesWeekly}
          onChange={(variesWeekly) => onChange({ ...data, variesWeekly })}
        />
      </QuestionSection>

      <QuestionSection title="Sono e estresse">
        <QuestionField>
          <FieldLabel htmlFor="sleep" optional>
            Quantas horas você dorme por noite, em média?
          </FieldLabel>
          <FieldHelp>O sono entra na conta da recuperação entre os treinos.</FieldHelp>
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
          legend="Como anda o seu nível de estresse no dia a dia?"
          help="Pense no último mês. Também ajuda a ajustar a recuperação."
          items={STRESS_ITEMS}
          value={data.stress || null}
          onChange={(stress) => onChange({ ...data, stress })}
          placeholder="Selecione o seu nível"
          optional
        />
      </QuestionSection>
    </StepFrame>
  );
}

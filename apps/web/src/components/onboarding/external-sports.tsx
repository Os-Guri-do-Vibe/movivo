'use client';

/**
 * Esportes que o aluno já pratica por fora (etapa 4, "Sua semana"). Não são prescritos pela
 * MOVIVO: entram como o que já ocupa a semana, para os treinos serem encaixados em volta.
 */
import {
  EXTERNAL_SPORT_LABELS,
  OTHER_SPORT_NAME_MAX,
  type ExternalSport,
  type Weekday,
} from '@movivo/shared';

import { RPE_ITEMS } from './anamnesis-options';
import { DAYS_PER_WEEK_ITEMS } from './choice-items';
import {
  ClockInput,
  Combobox,
  FieldError,
  FieldHelp,
  FieldLabel,
  FieldValidation,
  QuestionField,
  TextInput,
  YesNo,
} from './fields';
import {
  fixedDaysExceedSessions,
  newExternalSport,
  sportDurationError,
  sportOtherError,
  type ExternalSportDraft,
} from './onboarding-drafts';
import { Labeled } from './step-frame';
import { WEEKDAY_ITEMS } from './weekday-items';

const SPORT_ITEMS = (Object.keys(EXTERNAL_SPORT_LABELS) as ExternalSport[]).map((value) => ({
  value,
  label: EXTERNAL_SPORT_LABELS[value],
}));

const MAX_EXTERNAL_SPORTS = 3;

/** Liga/desliga o dia e devolve a lista na ordem da semana. */
function toggleDay(days: Weekday[], day: Weekday): Weekday[] {
  const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
  return WEEKDAY_ITEMS.map((item) => item.value).filter((value) => next.includes(value));
}

function ExternalSportFields({
  index,
  sport,
  unavailable,
  onChange,
  onRemove,
}: {
  index: number;
  sport: ExternalSportDraft;
  /** Esportes já escolhidos nos outros cartões: cada esporte aparece uma vez só. */
  unavailable: readonly (ExternalSport | null)[];
  onChange: (next: ExternalSportDraft) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-border bg-secondary/40 p-5">
      <p className="text-body font-semibold text-petroleo">Outro esporte {index + 1}</p>
      <Combobox
        id={`sport-name-${index}`}
        legend="Qual esporte?"
        items={SPORT_ITEMS.filter(
          (item) => item.value === 'OTHER' || !unavailable.includes(item.value),
        )}
        value={sport.sport}
        onChange={(value) =>
          onChange({
            ...sport,
            sport: value,
            sportOther: value === 'OTHER' ? sport.sportOther : '',
          })
        }
        placeholder="Selecione o esporte"
      />
      {sport.sport === 'OTHER' && (
        <div className="border-l-2 border-primary pl-4">
          <Labeled id={`sport-other-${index}`} label="Qual esporte você pratica?">
            <FieldValidation error={sportOtherError(sport)}>
              <TextInput
                id={`sport-other-${index}`}
                value={sport.sportOther}
                onChange={(sportOther) => onChange({ ...sport, sportOther })}
                placeholder="Ex.: jiu-jitsu, vôlei, escalada"
                maxLength={OTHER_SPORT_NAME_MAX}
              />
            </FieldValidation>
          </Labeled>
        </div>
      )}
      <Combobox
        id={`sport-sessions-${index}`}
        legend="Quantos dias por semana você pratica esse esporte?"
        items={DAYS_PER_WEEK_ITEMS}
        value={sport.sessions || null}
        onChange={(sessions) => onChange({ ...sport, sessions })}
        placeholder="Selecione a quantidade de dias"
      />
      <div className="flex flex-col gap-2">
        <Combobox
          id={`sport-fixed-days-${index}`}
          legend="Algum desses dias é fixo? Quais?"
          help="Marque só os dias que não mudam, como o jogo de toda quarta. A MOVIVO encaixa os treinos em volta deles."
          items={WEEKDAY_ITEMS}
          multiple
          value={sport.fixedDays}
          onChange={(day) => onChange({ ...sport, fixedDays: toggleDay(sport.fixedDays, day) })}
          placeholder="Nenhum dia fixo"
          optional
        />
        <FieldError
          message={
            fixedDaysExceedSessions(sport.sessions, sport.fixedDays)
              ? 'Há mais dias fixos marcados do que dias por semana. Ajuste um dos dois.'
              : undefined
          }
        />
      </div>
      <QuestionField>
        <FieldLabel htmlFor={`sport-duration-${index}`}>
          Quanto tempo dura cada sessão, em média?
        </FieldLabel>
        <FieldHelp>Ex.: 45:00 para 45 minutos, 1:30:00 para uma hora e meia.</FieldHelp>
        <FieldValidation error={sportDurationError(sport.duration)}>
          <ClockInput
            id={`sport-duration-${index}`}
            kind="race"
            placeholder="45:00"
            value={sport.duration}
            onChange={(duration) => onChange({ ...sport, duration })}
          />
        </FieldValidation>
      </QuestionField>
      <Combobox
        id={`sport-rpe-${index}`}
        legend="Quanto esse esporte costuma te cansar?"
        help="Pense numa sessão comum. Isso ajuda a equilibrar o esforço da sua semana."
        items={RPE_ITEMS}
        value={sport.rpe === null ? null : String(sport.rpe)}
        onChange={(rpe) => onChange({ ...sport, rpe: Number(rpe) })}
        placeholder="Selecione a intensidade"
      />
      <button
        type="button"
        onClick={onRemove}
        className="self-start text-label font-semibold underline underline-offset-4"
      >
        Remover este esporte
      </button>
    </div>
  );
}

export interface ExternalSportsValue {
  practicesOtherSport: boolean | undefined;
  externalSports: ExternalSportDraft[];
}

/** Pergunta-porta ("pratica outro esporte?") e um cartão por esporte, até 3. */
export function ExternalSports({
  value,
  onChange,
}: {
  value: ExternalSportsValue;
  onChange: (next: ExternalSportsValue) => void;
}) {
  const { externalSports } = value;
  return (
    <>
      <YesNo
        legend="Você pratica algum esporte por fora que quer manter, como luta, natação ou futebol?"
        value={value.practicesOtherSport}
        onChange={(yes) =>
          onChange({
            practicesOtherSport: yes,
            externalSports: yes
              ? externalSports.length > 0
                ? externalSports
                : [newExternalSport()]
              : [],
          })
        }
      />
      {value.practicesOtherSport && (
        <div className="flex flex-col gap-4">
          {externalSports.map((sport, index) => (
            <ExternalSportFields
              key={index}
              index={index}
              sport={sport}
              unavailable={externalSports.filter((_, other) => other !== index).map((s) => s.sport)}
              onChange={(next) =>
                onChange({
                  ...value,
                  externalSports: externalSports.map((s, i) => (i === index ? next : s)),
                })
              }
              onRemove={() => {
                const remaining = externalSports.filter((_, i) => i !== index);
                onChange({ externalSports: remaining, practicesOtherSport: remaining.length > 0 });
              }}
            />
          ))}
          {externalSports.length > 0 && externalSports.length < MAX_EXTERNAL_SPORTS && (
            <button
              type="button"
              onClick={() =>
                onChange({ ...value, externalSports: [...externalSports, newExternalSport()] })
              }
              className="self-start text-label font-semibold underline underline-offset-4"
            >
              Adicionar outro esporte
            </button>
          )}
        </div>
      )}
    </>
  );
}

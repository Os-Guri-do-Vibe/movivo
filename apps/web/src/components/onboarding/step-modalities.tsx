'use client';

import {
  EXTERNAL_SPORT_LABELS,
  SESSION_MODALITY_LABELS,
  type ExternalSport,
  type TrainingVenue,
  type Weekday,
} from '@movivo/shared';

import { ChoiceGroup, TextInput, YesNo } from './fields';
import { WEEKDAY_ITEMS } from './weekday-items';
import {
  modalitiesComplete,
  newExternalSport,
  type CoachedModalityKey,
  type ExternalSportDraft,
  type ModalitiesDraft,
  type ModalityDraft,
} from './onboarding-drafts';
import { Labeled, StepFrame } from './step-frame';

const MODALITY_KEYS: CoachedModalityKey[] = ['STRENGTH', 'RUNNING', 'HYROX'];

const MODALITY_ITEMS = MODALITY_KEYS.map((value) => ({
  value,
  label: SESSION_MODALITY_LABELS[value],
}));

const LEVEL_ITEMS: { value: ModalityDraft['level']; label: string }[] = [
  { value: 'BEGINNER', label: 'Iniciante' },
  { value: 'INTERMEDIATE', label: 'Intermediário' },
  { value: 'ADVANCED', label: 'Avançado' },
];

const VENUE_ITEMS: { value: TrainingVenue; label: string }[] = [
  { value: 'FULL_GYM', label: 'Academia completa' },
  { value: 'BASIC_GYM', label: 'Academia básica' },
  { value: 'CONDO_GYM', label: 'Academia do condomínio' },
  { value: 'HOME', label: 'Em casa' },
  { value: 'OUTDOOR', label: 'Ao ar livre' },
  { value: 'TRACK', label: 'Pista de atletismo' },
  { value: 'HYROX_GYM', label: 'Box com equipamento de HYROX' },
];

const SPORT_ITEMS = (Object.keys(EXTERNAL_SPORT_LABELS) as ExternalSport[]).map((value) => ({
  value,
  label: EXTERNAL_SPORT_LABELS[value],
}));

const RPE_ITEMS = [
  { value: '3', label: 'Leve' },
  { value: '5', label: 'Moderado' },
  { value: '7', label: 'Pesado' },
  { value: '9', label: 'Muito pesado' },
];

function ModalityFields({
  id,
  modality,
  data,
  onChange,
}: {
  id: CoachedModalityKey;
  modality: CoachedModalityKey;
  data: ModalityDraft;
  onChange: (next: ModalityDraft) => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border p-4">
      <p className="text-body font-semibold">{SESSION_MODALITY_LABELS[modality]}</p>
      <YesNo
        legend="Você já pratica?"
        value={data.practicing}
        onChange={(practicing) => onChange({ ...data, practicing })}
      />
      {data.practicing && (
        <>
          <ChoiceGroup
            legend="Seu nível hoje"
            items={LEVEL_ITEMS}
            selected={[data.level]}
            onToggle={(level) => onChange({ ...data, level })}
          />
          <Labeled id={`${id}-months`} label="Há quantos meses?">
            <TextInput
              id={`${id}-months`}
              inputMode="numeric"
              value={data.months}
              onChange={(months) => onChange({ ...data, months })}
            />
          </Labeled>
          <Labeled id={`${id}-sessions`} label="Quantas vezes por semana, em média?">
            <TextInput
              id={`${id}-sessions`}
              inputMode="numeric"
              value={data.sessions}
              onChange={(sessions) => onChange({ ...data, sessions })}
            />
          </Labeled>
          {modality === 'RUNNING' && (
            <>
              <Labeled
                id="run-km"
                label="Quantos km você corre por semana?"
                help="Pode ser uma estimativa."
              >
                <TextInput
                  id="run-km"
                  inputMode="decimal"
                  value={data.weeklyKm}
                  onChange={(weeklyKm) => onChange({ ...data, weeklyKm })}
                />
              </Labeled>
              <Labeled id="run-5k" label="Seu tempo recente nos 5 km (mm:ss)" help="Opcional.">
                <TextInput
                  id="run-5k"
                  placeholder="27:30"
                  value={data.fiveK}
                  onChange={(fiveK) => onChange({ ...data, fiveK })}
                />
              </Labeled>
            </>
          )}
          {modality === 'HYROX' && (
            <>
              <Labeled id="hyrox-races" label="Quantas provas de HYROX você já fez?">
                <TextInput
                  id="hyrox-races"
                  inputMode="numeric"
                  value={data.hyroxRaces}
                  onChange={(hyroxRaces) => onChange({ ...data, hyroxRaces })}
                />
              </Labeled>
              <Labeled id="hyrox-best" label="Melhor tempo (h:mm:ss)" help="Opcional.">
                <TextInput
                  id="hyrox-best"
                  placeholder="1:25:00"
                  value={data.hyroxBest}
                  onChange={(hyroxBest) => onChange({ ...data, hyroxBest })}
                />
              </Labeled>
            </>
          )}
        </>
      )}
    </div>
  );
}

function ExternalSportFields({
  index,
  sport,
  onChange,
  onRemove,
}: {
  index: number;
  sport: ExternalSportDraft;
  onChange: (next: ExternalSportDraft) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border p-4">
      <ChoiceGroup
        legend="Qual esporte?"
        items={SPORT_ITEMS}
        selected={[sport.sport]}
        onToggle={(value) => onChange({ ...sport, sport: value })}
        columns
      />
      <Labeled
        id={`sport-label-${index}`}
        label="Como você chama essa prática?"
        help="Ex.: jiu-jitsu, natação."
      >
        <TextInput
          id={`sport-label-${index}`}
          value={sport.label}
          onChange={(label) => onChange({ ...sport, label })}
          maxLength={80}
        />
      </Labeled>
      <Labeled id={`sport-sessions-${index}`} label="Vezes por semana">
        <TextInput
          id={`sport-sessions-${index}`}
          inputMode="numeric"
          value={sport.sessions}
          onChange={(sessions) => onChange({ ...sport, sessions })}
        />
      </Labeled>
      <Labeled id={`sport-minutes-${index}`} label="Minutos por sessão">
        <TextInput
          id={`sport-minutes-${index}`}
          inputMode="numeric"
          value={sport.minutes}
          onChange={(minutes) => onChange({ ...sport, minutes })}
        />
      </Labeled>
      <ChoiceGroup
        legend="Quão pesada costuma ser?"
        items={RPE_ITEMS}
        selected={[String(sport.rpe)]}
        onToggle={(rpe) => onChange({ ...sport, rpe: Number(rpe) })}
      />
      <ChoiceGroup
        legend="Dias fixos (se houver)"
        items={WEEKDAY_ITEMS}
        selected={sport.fixedDays}
        multi
        columns
        onToggle={(day: Weekday) =>
          onChange({
            ...sport,
            fixedDays: sport.fixedDays.includes(day)
              ? sport.fixedDays.filter((d) => d !== day)
              : [...sport.fixedDays, day],
          })
        }
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

export function StepModalities({
  data,
  onChange,
  onContinue,
  onBack,
  saving,
}: {
  data: ModalitiesDraft;
  onChange: (data: ModalitiesDraft) => void;
  onContinue: () => void;
  onBack?: () => void;
  saving: boolean;
}) {
  const selected = MODALITY_KEYS.filter((key) => data.modalities[key].selected);
  return (
    <StepFrame
      title="O que você treina ou quer treinar?"
      description="Pode escolher mais de uma. A MOVIVO monta tudo junto, sem semanas impossíveis."
      canContinue={modalitiesComplete(data)}
      saving={saving}
      onContinue={onContinue}
      onBack={onBack}
    >
      <ChoiceGroup
        legend="Modalidades"
        items={MODALITY_ITEMS}
        selected={selected}
        multi
        onToggle={(key) =>
          onChange({
            ...data,
            modalities: {
              ...data.modalities,
              [key]: { ...data.modalities[key], selected: !data.modalities[key].selected },
            },
          })
        }
      />
      {selected.map((key) => (
        <ModalityFields
          key={key}
          id={key}
          modality={key}
          data={data.modalities[key]}
          onChange={(next) =>
            onChange({ ...data, modalities: { ...data.modalities, [key]: next } })
          }
        />
      ))}

      <YesNo
        legend="Você pratica outro esporte que quer manter (luta, natação, futebol…)?"
        value={data.externalSports.length > 0}
        onChange={(yes) => onChange({ ...data, externalSports: yes ? [newExternalSport()] : [] })}
      />
      {data.externalSports.map((sport, index) => (
        <ExternalSportFields
          key={index}
          index={index}
          sport={sport}
          onChange={(next) =>
            onChange({
              ...data,
              externalSports: data.externalSports.map((s, i) => (i === index ? next : s)),
            })
          }
          onRemove={() =>
            onChange({ ...data, externalSports: data.externalSports.filter((_, i) => i !== index) })
          }
        />
      ))}
      {data.externalSports.length > 0 && data.externalSports.length < 3 && (
        <button
          type="button"
          onClick={() =>
            onChange({ ...data, externalSports: [...data.externalSports, newExternalSport()] })
          }
          className="self-start text-label font-semibold underline underline-offset-4"
        >
          Adicionar outro esporte
        </button>
      )}

      <ChoiceGroup
        legend="Onde você treina?"
        items={VENUE_ITEMS}
        selected={data.venues}
        multi
        stack
        onToggle={(venue) =>
          onChange({
            ...data,
            venues: data.venues.includes(venue)
              ? data.venues.filter((v) => v !== venue)
              : [...data.venues, venue],
          })
        }
      />
    </StepFrame>
  );
}

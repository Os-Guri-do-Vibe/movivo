'use client';

import {
  EXTERNAL_SPORT_LABELS,
  SESSION_MODALITY_LABELS,
  VENUES_BY_MODALITY,
  type ExternalSport,
  type TrainingVenue,
  type Weekday,
} from '@movivo/shared';

import { DAYS_PER_WEEK_ITEMS } from './choice-items';
import {
  ChoiceGroup,
  ClockInput,
  Combobox,
  FieldError,
  FieldLabel,
  FieldValidation,
  QuestionField,
  UnitInput,
  YesNo,
  selectionHint,
  QuestionMeta,
} from './fields';
import {
  fiveKError,
  fixedDaysExceedSessions,
  hyroxBestError,
  hyroxRacesError,
  modalitiesComplete,
  newExternalSport,
  sportDurationError,
  weeklyKmError,
  type CoachedModalityKey,
  type ExternalSportDraft,
  type ModalitiesDraft,
  type ModalityDraft,
} from './onboarding-drafts';
import { Labeled, StepFrame } from './step-frame';
import { WEEKDAY_ITEMS } from './weekday-items';
import { cn } from '@/lib/utils';

const MODALITY_KEYS: CoachedModalityKey[] = ['STRENGTH', 'RUNNING', 'HYROX'];

/** Fotos das modalidades (`public/assets/modalities`). */
const MODALITY_PHOTOS: Record<CoachedModalityKey, string> = {
  STRENGTH: '/assets/modalities/musculacao.webp',
  RUNNING: '/assets/modalities/corrida.webp',
  HYROX: '/assets/modalities/hyrox.webp',
};

/** Nome da modalidade no meio de uma frase. */
export const MODALITY_NAME: Record<CoachedModalityKey, string> = {
  STRENGTH: 'musculação',
  RUNNING: 'corrida',
  HYROX: 'HYROX',
};

type LevelItem = { value: NonNullable<ModalityDraft['level']>; label: string; description: string };

/** Descrições curtas de cada nível, por modalidade, para o aluno se autoavaliar com mais precisão. */
const LEVEL_ITEMS: Record<CoachedModalityKey, LevelItem[]> = {
  STRENGTH: [
    {
      value: 'BEGINNER',
      label: 'Iniciante',
      description:
        'Treino há menos de 6 meses ou ainda preciso de ajuda para executar os exercícios.',
    },
    {
      value: 'INTERMEDIATE',
      label: 'Intermediário',
      description: 'Treino com regularidade há mais de 6 meses e conheço os principais exercícios.',
    },
    {
      value: 'ADVANCED',
      label: 'Avançado',
      description:
        'Treino há mais de 2 anos, com constância, e entendo sobre controle de cargas e progressão corretamente.',
    },
  ],
  RUNNING: [
    {
      value: 'BEGINNER',
      label: 'Iniciante',
      description: 'Corro há pouco tempo ou ainda alterno corrida e caminhada.',
    },
    {
      value: 'INTERMEDIATE',
      label: 'Intermediário',
      description: 'Corro 5km abaixo de 25 minutos e treino toda semana.',
    },
    {
      value: 'ADVANCED',
      label: 'Avançado',
      description: 'Sigo planilha, controlo ritmo e distância e corro provas com frequência.',
    },
  ],
  HYROX: [
    {
      value: 'BEGINNER',
      label: 'Iniciante',
      description: 'Nunca fiz HYROX ou conheço pouco as estações e a prova.',
    },
    {
      value: 'INTERMEDIATE',
      label: 'Intermediário',
      description: 'Conheço as 8 estações e já treinei o formato ou fiz alguma prova.',
    },
    {
      value: 'ADVANCED',
      label: 'Avançado',
      description: 'Treino o formato com frequência e busco melhorar meu tempo em prova.',
    },
  ],
};

/** Como cada local se chama em cada modalidade (na corrida, academia é esteira). */
const VENUE_LABELS: Record<CoachedModalityKey, Partial<Record<TrainingVenue, string>>> = {
  STRENGTH: {
    FULL_GYM: 'Academia completa',
    CONDO_GYM: 'Academia de condomínio',
    HOME: 'Em casa',
    OUTDOOR: 'Ao ar livre (praça, parque)',
  },
  RUNNING: {
    OUTDOOR: 'Na rua, parque ou trilha',
    TRACK: 'Na pista de atletismo',
    FULL_GYM: 'Na esteira da academia',
    CONDO_GYM: 'Na esteira do condomínio',
  },
  HYROX: {
    HYROX_GYM: 'Box com equipamento de HYROX',
    FULL_GYM: 'Academia completa',
    CONDO_GYM: 'Academia de condomínio',
    HOME: 'Em casa',
  },
};

const SPORT_ITEMS = (Object.keys(EXTERNAL_SPORT_LABELS) as ExternalSport[]).map((value) => ({
  value,
  label: EXTERNAL_SPORT_LABELS[value],
}));

const RPE_ITEMS = [
  { value: '3', label: 'Leve', description: 'Dá para conversar sem esforço.' },
  { value: '5', label: 'Moderada', description: 'Respiração acelerada, mas confortável.' },
  { value: '7', label: 'Intensa', description: 'Desafiadora, só consigo falar frases curtas.' },
  { value: '9', label: 'Muito intensa', description: 'Perto do meu limite, saio exausto(a).' },
];

const MAX_EXTERNAL_SPORTS = 3;

/** Liga/desliga o dia e devolve a lista na ordem da semana. */
function toggleDay(days: Weekday[], day: Weekday): Weekday[] {
  const next = days.includes(day) ? days.filter((d) => d !== day) : [...days, day];
  return WEEKDAY_ITEMS.map((item) => item.value).filter((value) => next.includes(value));
}

function ModalityCards({
  selected,
  onToggle,
}: {
  selected: readonly CoachedModalityKey[];
  onToggle: (key: CoachedModalityKey) => void;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-body font-semibold text-foreground">
        Quais modalidades você treina ou quer treinar?
      </legend>
      <div className="mt-0.5">
        <QuestionMeta hint={selectionHint(true, undefined)} />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-3">
        {MODALITY_KEYS.map((key) => {
          const isSelected = selected.includes(key);
          return (
            <button
              key={key}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onToggle(key)}
              className={cn(
                'group relative flex aspect-[3/4] w-full items-end overflow-hidden rounded-2xl border-2 p-0 text-left outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-white',
                isSelected
                  ? 'border-primary shadow-[0_8px_24px_rgba(6,48,42,0.28)]'
                  : 'border-transparent hover:border-petroleo',
              )}
            >
              <span
                aria-hidden="true"
                data-modality-image={key}
                className={cn(
                  'absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105',
                  !isSelected && 'saturate-75',
                )}
                style={{ backgroundImage: `url(${MODALITY_PHOTOS[key]})` }}
              />
              <span
                aria-hidden="true"
                className={cn(
                  'absolute inset-0 bg-linear-to-t via-transparent transition-colors',
                  isSelected
                    ? 'from-petroleo/90 to-petroleo/10'
                    : 'from-petroleo/80 to-transparent',
                )}
              />
              <span
                aria-hidden="true"
                className={cn(
                  'absolute left-2 top-2 flex size-5 items-center justify-center rounded-full border text-[0.6875rem] font-bold sm:size-6 sm:text-label',
                  isSelected
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-white/80 bg-black/20 text-transparent',
                )}
              >
                ✓
              </span>
              <span className="relative w-full px-2 pb-3 text-center text-label font-semibold leading-4 text-white sm:text-body">
                {SESSION_MODALITY_LABELS[key]}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function ModalityFields({
  modality,
  data,
  onChange,
}: {
  modality: CoachedModalityKey;
  data: ModalityDraft;
  onChange: (next: ModalityDraft) => void;
}) {
  const name = MODALITY_NAME[modality];
  return (
    <div className="flex flex-col gap-6 rounded-xl border border-border p-4">
      <p className="text-body font-semibold">{SESSION_MODALITY_LABELS[modality]}</p>
      <YesNo
        legend={`Você já pratica ${name}?`}
        value={data.practicing ?? undefined}
        onChange={(practicing) => onChange({ ...data, practicing })}
      />
      {data.practicing && (
        <>
          <Combobox
            id={`${modality}-level`}
            legend="Qual seu nível atual?"
            items={LEVEL_ITEMS[modality]}
            value={data.level}
            onChange={(level) => onChange({ ...data, level })}
          />
          <Combobox
            id={`${modality}-sessions`}
            legend={`Hoje, quantos dias por semana você pratica ${name}?`}
            help="É o seu ponto de partida. Quantos treinos você vai fazer com a MOVIVO, você escolhe na próxima etapa."
            items={DAYS_PER_WEEK_ITEMS}
            value={data.sessions || null}
            onChange={(sessions) => onChange({ ...data, sessions })}
            placeholder="Selecione a quantidade de dias"
          />
          {modality === 'RUNNING' && (
            <>
              <Labeled id="run-km" label="Em média, quantos km você corre por semana?">
                <FieldValidation error={weeklyKmError(data.weeklyKm)}>
                  <UnitInput
                    id="run-km"
                    unit="km"
                    maxInteger={3}
                    decimals={1}
                    placeholder="0 km"
                    value={data.weeklyKm}
                    onChange={(weeklyKm) => onChange({ ...data, weeklyKm })}
                  />
                </FieldValidation>
              </Labeled>
              <Labeled id="run-5k" label="Qual seu tempo atual nos 5 km?" optional>
                <FieldValidation error={fiveKError(data.fiveK)}>
                  <ClockInput
                    id="run-5k"
                    kind="race"
                    placeholder="mm:ss"
                    value={data.fiveK}
                    onChange={(fiveK) => onChange({ ...data, fiveK })}
                  />
                </FieldValidation>
              </Labeled>
            </>
          )}
          {modality === 'HYROX' && (
            <>
              <Labeled id="hyrox-races" label="Quantas provas de HYROX você já fez?">
                <FieldValidation error={hyroxRacesError(data.hyroxRaces)}>
                  <UnitInput
                    id="hyrox-races"
                    unit={(races) => (races === '1' ? 'prova' : 'provas')}
                    maxInteger={3}
                    placeholder="0"
                    value={data.hyroxRaces}
                    onChange={(hyroxRaces) => onChange({ ...data, hyroxRaces })}
                  />
                </FieldValidation>
              </Labeled>
              {Number(data.hyroxRaces) > 0 && (
                <Labeled id="hyrox-best" label="Qual seu melhor no HYROX completo?" optional>
                  <FieldValidation error={hyroxBestError(data.hyroxBest)}>
                    <ClockInput
                      id="hyrox-best"
                      kind="hms"
                      placeholder="hh:mm:ss"
                      value={data.hyroxBest}
                      onChange={(hyroxBest) => onChange({ ...data, hyroxBest })}
                    />
                  </FieldValidation>
                </Labeled>
              )}
            </>
          )}
        </>
      )}
      <ChoiceGroup
        legend={`Onde você vai fazer a maior parte dos treinos de ${name}?`}
        items={VENUES_BY_MODALITY[modality].map((value) => ({
          value,
          label: VENUE_LABELS[modality][value] ?? value,
        }))}
        selected={data.venue ? [data.venue] : []}
        onToggle={(venue) => onChange({ ...data, venue })}
        layout="stack"
      />
    </div>
  );
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
        items={SPORT_ITEMS.filter((item) => !unavailable.includes(item.value))}
        value={sport.sport}
        onChange={(value) => onChange({ ...sport, sport: value })}
        placeholder="Selecione o esporte"
      />
      <Combobox
        id={`sport-sessions-${index}`}
        legend="Quantos dias na semana você pratica?"
        items={DAYS_PER_WEEK_ITEMS}
        value={sport.sessions || null}
        onChange={(sessions) => onChange({ ...sport, sessions })}
        placeholder="Selecione a quantidade de dias"
      />
      <div className="flex flex-col gap-2">
        <Combobox
          id={`sport-fixed-days-${index}`}
          legend="Em quais dias você pratica esse esporte?"
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
              ? 'Você marcou mais dias fixos do que dias por semana.'
              : undefined
          }
        />
      </div>
      <QuestionField>
        <FieldLabel htmlFor={`sport-duration-${index}`}>
          Qual a duração média das sessões de treino?
        </FieldLabel>
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
        legend="Qual a intensidade média dessa prática?"
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
      description="Pode escolher mais de uma. A MOVIVO organiza tudo junto na sua semana."
      canContinue={modalitiesComplete(data)}
      saving={saving}
      onContinue={onContinue}
      onBack={onBack}
    >
      <ModalityCards
        selected={selected}
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
          modality={key}
          data={data.modalities[key]}
          onChange={(next) =>
            onChange({ ...data, modalities: { ...data.modalities, [key]: next } })
          }
        />
      ))}

      <YesNo
        legend="Você pratica outro esporte que quer manter (luta, natação, futebol…)?"
        value={data.practicesOtherSport}
        onChange={(yes) =>
          onChange({
            ...data,
            practicesOtherSport: yes,
            externalSports: yes
              ? data.externalSports.length > 0
                ? data.externalSports
                : [newExternalSport()]
              : [],
          })
        }
      />
      {data.practicesOtherSport && (
        <div className="flex flex-col gap-4">
          {data.externalSports.map((sport, index) => (
            <ExternalSportFields
              key={index}
              index={index}
              sport={sport}
              unavailable={data.externalSports
                .filter((_, other) => other !== index)
                .map((s) => s.sport)}
              onChange={(next) =>
                onChange({
                  ...data,
                  externalSports: data.externalSports.map((s, i) => (i === index ? next : s)),
                })
              }
              onRemove={() => {
                const externalSports = data.externalSports.filter((_, i) => i !== index);
                onChange({
                  ...data,
                  externalSports,
                  practicesOtherSport: externalSports.length > 0,
                });
              }}
            />
          ))}
          {data.externalSports.length > 0 && data.externalSports.length < MAX_EXTERNAL_SPORTS && (
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
        </div>
      )}
    </StepFrame>
  );
}

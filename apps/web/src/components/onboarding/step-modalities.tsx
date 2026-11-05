'use client';

import { SESSION_MODALITY_LABELS, VENUES_BY_MODALITY, type TrainingVenue } from '@movivo/shared';

import {
  ChoiceGroup,
  ClockInput,
  Combobox,
  FieldValidation,
  UnitInput,
  YesNo,
  selectionHint,
  QuestionMeta,
} from './fields';
import {
  fiveKError,
  hyroxBestError,
  hyroxRacesError,
  modalitiesComplete,
  weeklyKmError,
  type CoachedModalityKey,
  type ModalitiesDraft,
  type ModalityDraft,
} from './onboarding-drafts';
import { Labeled, StepFrame } from './step-frame';
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
        'Treino com constância há mais de 2 anos e sei ajustar carga e progressão por conta própria.',
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
      description: 'Treino toda semana e corro 5 km em menos de 25 minutos.',
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

/** O que cada local oferece: é o que define os exercícios possíveis. */
const VENUE_DESCRIPTIONS: Record<CoachedModalityKey, Partial<Record<TrainingVenue, string>>> = {
  STRENGTH: {
    FULL_GYM: 'Máquinas, cabos, barras e pesos livres.',
    CONDO_GYM: 'Poucos aparelhos e halteres mais leves.',
    HOME: 'Peso do corpo e o que você tiver em casa.',
    OUTDOOR: 'Peso do corpo e barras de praça.',
  },
  RUNNING: {},
  HYROX: {
    HYROX_GYM: 'Trenó, remo, ski erg e wall ball.',
    FULL_GYM: 'Máquinas e pesos, sem todo o equipamento da prova.',
    CONDO_GYM: 'Poucos aparelhos e halteres mais leves.',
    HOME: 'Peso do corpo e o que você tiver em casa.',
  },
};

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
        Quais destas você quer treinar com a MOVIVO?
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
        legend={`Você já pratica ${name} hoje?`}
        value={data.practicing ?? undefined}
        onChange={(practicing) => onChange({ ...data, practicing })}
      />
      {data.practicing && (
        <>
          <Combobox
            id={`${modality}-level`}
            legend={`Qual é o seu nível em ${name}?`}
            help="Escolha a descrição mais parecida com você hoje. Ela define o ponto de partida do treino."
            items={LEVEL_ITEMS[modality]}
            value={data.level}
            onChange={(level) => onChange({ ...data, level })}
            placeholder="Selecione o seu nível"
          />
          {modality === 'RUNNING' && (
            <>
              <Labeled
                id="run-km"
                label="Em média, quantos km você corre por semana?"
                help="Some as corridas de uma semana comum. Ex.: 3 treinos de 5 km = 15 km."
              >
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
              <Labeled
                id="run-5k"
                label="Quanto tempo você leva hoje para correr 5 km?"
                help="Em minutos e segundos (ex.: 28:30). Uma estimativa recente serve. Se nunca mediu, deixe em branco."
                optional
              >
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
              <Labeled
                id="hyrox-races"
                label="Quantas provas de HYROX você já fez?"
                help="Se ainda não fez nenhuma, coloque 0."
              >
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
                <Labeled
                  id="hyrox-best"
                  label="Qual é o seu melhor tempo numa prova completa de HYROX?"
                  help="Em horas, minutos e segundos (ex.: 01:25:00)."
                  optional
                >
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
        help={
          modality === 'RUNNING' ? undefined : 'Define quais equipamentos entram no seu treino.'
        }
        items={VENUES_BY_MODALITY[modality].map((value) => ({
          value,
          label: VENUE_LABELS[modality][value] ?? value,
          description: VENUE_DESCRIPTIONS[modality][value],
        }))}
        selected={data.venue ? [data.venue] : []}
        onToggle={(venue) => onChange({ ...data, venue })}
        layout="stack"
      />
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
      title="Seu treino com a MOVIVO"
      description="Escolha o que você quer treinar com a gente e conte de onde você parte: é isso que define o ponto de partida e os exercícios do seu treino. Esporte que você pratica por fora entra na próxima etapa."
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
    </StepFrame>
  );
}

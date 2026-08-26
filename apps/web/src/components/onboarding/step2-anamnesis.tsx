'use client';

import * as React from 'react';

import {
  EMPHASIS_REGION_LABELS,
  PRIMARY_GOAL_LABELS,
  TRAINING_LOCATION_LABELS,
  type ConsistencyBarrier,
  type EmphasisRegion,
  type PastActivity,
  type PreferredPeriod,
  type PrimaryGoal,
  type SessionDuration,
  type StoppedFor,
  type TrainingExperience,
  type TrainingLocation,
  type TrainingStatus,
  type Weekday,
} from '@movivo/shared';

import {
  ChoiceGroup,
  Combobox,
  FieldLabel,
  QuestionField,
  QuestionStack,
  TextArea,
  TextInput,
  YesNo,
} from './fields';
import { DatePicker } from './date-picker';
import { EMPTY_PAIN, PainSection, type PainData } from './pain-section';

export interface Step2State {
  primaryGoal: PrimaryGoal | null;
  primaryGoalOther: string;
  emphasis: EmphasisRegion[];
  hasImportantEvent: boolean;
  importantEventDate: string;
  importantEventDescription: string;
  trainingStatus: TrainingStatus | null;
  stoppedFor: StoppedFor | null;
  experience: TrainingExperience | null;
  pastActivities: PastActivity[];
  pastActivityOther: string;
  consistencyBarriers: ConsistencyBarrier[];
  consistencyBarrierOther: string;
  daysPerWeek: number | null;
  preferredDays: Weekday[];
  sessionDuration: SessionDuration | null;
  location: TrainingLocation | null;
  preferredPeriod: PreferredPeriod | null;
  hasAvoidedExercise: boolean;
  avoidedExercise: string;
  pain: PainData;
}

export const EMPTY_STEP2: Step2State = {
  primaryGoal: null,
  primaryGoalOther: '',
  emphasis: [],
  hasImportantEvent: false,
  importantEventDate: '',
  importantEventDescription: '',
  trainingStatus: null,
  stoppedFor: null,
  experience: null,
  pastActivities: [],
  pastActivityOther: '',
  consistencyBarriers: [],
  consistencyBarrierOther: '',
  daysPerWeek: null,
  preferredDays: [],
  sessionDuration: null,
  location: null,
  preferredPeriod: null,
  hasAvoidedExercise: false,
  avoidedExercise: '',
  pain: EMPTY_PAIN,
};

const GOAL_OPTION_VALUES = [
  'GAIN_MUSCLE',
  'GAIN_STRENGTH',
  'LOSE_FAT',
  'CONDITIONING',
  'HEALTH_ENERGY',
  'SPORT_EVENT',
  'OTHER',
] as const satisfies readonly PrimaryGoal[];
const GOAL_ITEMS = GOAL_OPTION_VALUES.map((value) => ({
  value,
  label: PRIMARY_GOAL_LABELS[value],
}));
type VisibleEmphasisRegion = Exclude<EmphasisRegion, 'FULL_BODY' | 'TRICEPS'>;
const EMPHASIS_OPTION_VALUES = [
  'CHEST',
  'BACK',
  'SHOULDERS',
  'BICEPS',
  'ABS_CORE',
  'QUADS',
  'HAMSTRINGS',
  'GLUTES',
  'CALVES',
] as const satisfies readonly VisibleEmphasisRegion[];
const EMPHASIS_ICON_URLS: Readonly<Record<VisibleEmphasisRegion, string>> = {
  CHEST: 'https://img.icons8.com/color/100/chest.png',
  BACK: 'https://img.icons8.com/color/100/back-muscles.png',
  SHOULDERS: 'https://img.icons8.com/color/100/shoulders.png',
  BICEPS: 'https://img.icons8.com/color/100/muscle-flexing.png',
  ABS_CORE: 'https://img.icons8.com/color/100/torso.png',
  QUADS: 'https://img.icons8.com/color/100/quadriceps.png',
  HAMSTRINGS: 'https://img.icons8.com/color/100/hamstrings.png',
  GLUTES: 'https://img.icons8.com/color/100/glutes.png',
  CALVES: 'https://img.icons8.com/color/100/calves.png',
};
export const STATUS_ITEMS: { value: TrainingStatus; label: string }[] = [
  { value: 'NEVER', label: 'Nunca treinei' },
  { value: 'STOPPED', label: 'Estou parado' },
  { value: 'OCCASIONAL', label: 'Treino ocasionalmente' },
  { value: 'REGULAR', label: 'Treino regularmente' },
];
export const STOPPED_FOR_ITEMS: { value: StoppedFor; label: string }[] = [
  { value: 'LT_3_MONTHS', label: 'Menos de 1 mês' },
  { value: 'M3_TO_6', label: 'Entre 1 e 3 meses' },
  { value: 'M6_TO_12', label: 'Entre 4 e 6 meses' },
  { value: 'Y1_TO_2', label: 'Entre 7 e 12 meses' },
  { value: 'GT_2_YEARS', label: 'Mais de 1 ano' },
];
export const EXPERIENCE_ITEMS: { value: TrainingExperience; label: string }[] = [
  { value: 'BEGINNER', label: 'Iniciante: nunca treinei ou ainda preciso de bastante orientação' },
  {
    value: 'INTERMEDIATE',
    label: 'Intermediário: conheço os principais exercícios e já treinei com regularidade',
  },
  {
    value: 'ADVANCED',
    label: 'Avançado: treino consistentemente e tenho experiência com controle de cargas',
  },
];
export const ACTIVITY_ITEMS: { value: PastActivity; label: string }[] = [
  { value: 'NONE', label: 'Nenhuma' },
  { value: 'WEIGHT_TRAINING', label: 'Musculação' },
  { value: 'WALK_RUN', label: 'Corrida' },
  { value: 'CYCLING', label: 'Ciclismo' },
  { value: 'FUNCTIONAL_CROSSFIT', label: 'Treino funcional / Cross training' },
  { value: 'FOOTBALL', label: 'Esportes coletivos' },
  { value: 'MARTIAL_ARTS', label: 'Lutas' },
  { value: 'DANCE', label: 'Dança' },
  { value: 'YOGA_PILATES', label: 'Pilates' },
  { value: 'SWIMMING', label: 'Natação' },
  { value: 'OTHER', label: 'Outra' },
];
const ACTIVITY_VALUES_EXCEPT_NONE = ACTIVITY_ITEMS.filter((item) => item.value !== 'NONE').map(
  (item) => item.value,
);
export const BARRIER_ITEMS: { value: ConsistencyBarrier; label: string }[] = [
  { value: 'LACK_OF_TIME', label: 'Falta de tempo' },
  { value: 'LACK_OF_MOTIVATION', label: 'Falta de motivação' },
  { value: 'DONT_KNOW_WHAT_TO_DO', label: 'Não saber o que fazer' },
  { value: 'TIREDNESS', label: 'Treinos muito longos' },
  { value: 'PAIN_OR_INJURY', label: 'Dor ou lesão' },
  { value: 'ROUTINE_CHANGE', label: 'Rotina imprevisível' },
  { value: 'NO_RESULTS', label: 'Falta de resultados' },
  { value: 'EMBARRASSMENT', label: 'Não me identificava com os treinos' },
  { value: 'COST', label: 'Nunca tentei manter uma rotina' },
  { value: 'OTHER', label: 'Outro' },
];
const DAYS_ITEMS = [1, 2, 3, 4, 5, 6, 7].map((n) => ({
  value: String(n),
  label: `${n} dia${n > 1 ? 's' : ''}`,
}));
export const WEEKDAY_ITEMS: { value: Weekday; label: string }[] = [
  { value: 'MON', label: 'Segunda' },
  { value: 'TUE', label: 'Terça' },
  { value: 'WED', label: 'Quarta' },
  { value: 'THU', label: 'Quinta' },
  { value: 'FRI', label: 'Sexta' },
  { value: 'SAT', label: 'Sábado' },
  { value: 'SUN', label: 'Domingo' },
];
export const DURATION_ITEMS: { value: SessionDuration; label: string }[] = [
  { value: 'LT_30', label: 'Até 20 minutos' },
  { value: 'M30_TO_45', label: 'Aproximadamente 30 minutos' },
  { value: 'M45_TO_60', label: 'Aproximadamente 45 minutos' },
  { value: 'M60_TO_90', label: 'Aproximadamente 60 minutos' },
  { value: 'GT_90', label: 'Mais de 60 minutos' },
];
const LOCATION_ITEMS = (Object.keys(TRAINING_LOCATION_LABELS) as TrainingLocation[]).map(
  (value) => ({
    value,
    label: TRAINING_LOCATION_LABELS[value],
  }),
);
export const PERIOD_ITEMS: { value: PreferredPeriod; label: string }[] = [
  { value: 'MORNING', label: 'Manhã' },
  { value: 'AFTERNOON', label: 'Tarde' },
  { value: 'NIGHT', label: 'Noite' },
  { value: 'VARIES', label: 'Varia conforme o dia' },
];

function MuscleRegionIcon({ region }: { region: VisibleEmphasisRegion }) {
  const iconUrl = EMPHASIS_ICON_URLS[region];

  return (
    <span
      aria-hidden="true"
      data-icons8-icon={region}
      className="size-10 shrink-0 bg-contain bg-center bg-no-repeat sm:size-16"
      style={{
        backgroundImage: `url(${iconUrl})`,
      }}
    />
  );
}

function normalizeVisibleEmphasis(regions: readonly EmphasisRegion[]): VisibleEmphasisRegion[] {
  const normalized: VisibleEmphasisRegion[] = [];

  for (const region of regions) {
    if (region === 'FULL_BODY') continue;
    const visibleRegion: VisibleEmphasisRegion = region === 'TRICEPS' ? 'BICEPS' : region;
    if (!normalized.includes(visibleRegion)) normalized.push(visibleRegion);
  }

  return normalized.slice(0, 2);
}

function hasText(value: string) {
  return value.trim().length > 0;
}

function EmphasisRegionGrid({
  selected,
  onToggle,
}: {
  selected: readonly VisibleEmphasisRegion[];
  onToggle: (region: VisibleEmphasisRegion) => void;
}) {
  const isAtLimit = selected.length >= 2;

  return (
    <fieldset className="min-w-0">
      <legend className="text-body font-semibold text-foreground">
        Em quais regiões você gostaria de dar mais ênfase? (opcional)
      </legend>
      <p className="mt-2 text-label text-muted-foreground" aria-live="polite">
        Escolhidas: <span className="font-mono text-foreground">{selected.length} de 2</span>
        {isAtLimit && <span> · Limite de 2 regiões atingido.</span>}
      </p>
      <div className="mt-2 grid w-full grid-cols-3 gap-3">
        {EMPHASIS_OPTION_VALUES.map((region) => {
          const isSelected = selected.includes(region);
          const isDisabled = !isSelected && isAtLimit;

          return (
            <button
              key={region}
              type="button"
              aria-pressed={isSelected}
              aria-disabled={isDisabled || undefined}
              onClick={() => !isDisabled && onToggle(region)}
              className={`relative flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-2xl border p-2 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-white sm:gap-2 sm:p-3 ${
                isSelected
                  ? 'border-petroleo bg-accent text-petroleo ring-1 ring-inset ring-petroleo'
                  : 'border-input bg-white text-foreground hover:border-petroleo hover:bg-secondary'
              } ${isDisabled ? 'opacity-50' : ''}`}
            >
              {isSelected && (
                <span
                  aria-hidden="true"
                  className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full border border-petroleo bg-primary text-[0.6875rem] font-bold text-primary-foreground sm:right-2 sm:top-2 sm:size-6 sm:text-label"
                >
                  ✓
                </span>
              )}
              <MuscleRegionIcon region={region} />
              <span className="text-center text-xs font-semibold leading-4 sm:text-label">
                {EMPHASIS_REGION_LABELS[region]}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function Step2Anamnesis({
  data,
  onChange,
  onContinue,
  onBack,
  initialSection = 0,
  onSectionChange,
  saving,
}: {
  data: Step2State;
  onChange: (data: Step2State) => void;
  onContinue: () => void;
  onBack?: () => void;
  initialSection?: number;
  onSectionChange?: (section: number) => void;
  saving: boolean;
}) {
  const [section, setSection] = React.useState(Math.min(4, Math.max(0, initialSection)));
  const [firstEventDate] = React.useState(() => {
    const tomorrow = new Date();
    tomorrow.setHours(0, 0, 0, 0);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return tomorrow;
  });
  const titleRef = React.useRef<HTMLHeadingElement>(null);

  React.useEffect(() => {
    titleRef.current?.focus();
  }, [section]);

  function set<K extends keyof Step2State>(key: K, value: Step2State[K]) {
    onChange({ ...data, [key]: value });
  }

  function navigate(next: number) {
    const bounded = Math.min(4, Math.max(0, next));
    setSection(bounded);
    onSectionChange?.(bounded);
  }

  function toggleEmphasis(region: VisibleEmphasisRegion) {
    const current = normalizeVisibleEmphasis(data.emphasis);
    set(
      'emphasis',
      current.includes(region)
        ? current.filter((item) => item !== region)
        : [...current, region].slice(0, 2),
    );
  }

  function toggleActivity(value: PastActivity) {
    const values = data.pastActivities;
    if (value === 'NONE') {
      set('pastActivities', values.includes('NONE') ? [] : ['NONE']);
      return;
    }
    if (values.includes('NONE')) return;
    set(
      'pastActivities',
      values.includes(value) ? values.filter((item) => item !== value) : [...values, value],
    );
  }

  function toggleArray<K extends 'consistencyBarriers' | 'preferredDays'>(
    key: K,
    value: Step2State[K][number],
  ) {
    const values = data[key] as Step2State[K][number][];
    set(
      key,
      (values.includes(value)
        ? values.filter((item) => item !== value)
        : [...values, value]) as Step2State[K],
    );
  }

  const importantEventDate = new Date(`${data.importantEventDate}T00:00:00`);
  const importantEventComplete =
    !data.hasImportantEvent ||
    (!Number.isNaN(importantEventDate.getTime()) &&
      importantEventDate >= firstEventDate &&
      hasText(data.importantEventDescription));
  const objectiveComplete =
    data.primaryGoal !== null &&
    (data.primaryGoal !== 'OTHER' || hasText(data.primaryGoalOther)) &&
    importantEventComplete;
  const historyComplete =
    data.trainingStatus !== null &&
    (data.trainingStatus !== 'STOPPED' || data.stoppedFor !== null) &&
    data.experience !== null &&
    (!data.pastActivities.includes('OTHER') || hasText(data.pastActivityOther)) &&
    (!data.consistencyBarriers.includes('OTHER') || hasText(data.consistencyBarrierOther));
  const routineComplete =
    data.daysPerWeek !== null &&
    data.sessionDuration !== null &&
    data.location !== null &&
    data.preferredPeriod !== null;
  const painComplete =
    !data.pain.hasPain ||
    (data.pain.points.length > 0 &&
      data.pain.trend !== null &&
      data.pain.points.every(
        (point) => point.region !== 'OTHER' || point.regionOther.trim().length > 0,
      ) &&
      (!data.pain.hasProfessionalExplanation || hasText(data.pain.professionalExplanation)) &&
      (!data.pain.hasAvoidanceRecommendation || hasText(data.pain.avoidanceRecommendation)));
  const preferencesComplete = !data.hasAvoidedExercise || hasText(data.avoidedExercise);

  const canSubmitStep =
    objectiveComplete && historyComplete && routineComplete && painComplete && preferencesComplete;

  const sectionComplete = [
    objectiveComplete,
    historyComplete,
    routineComplete,
    painComplete,
    canSubmitStep,
  ][section];

  const visibleEmphasis = normalizeVisibleEmphasis(data.emphasis);

  const sectionHeader = (title: string, description: string) => (
    <div>
      <h1
        ref={titleRef}
        id="step2-title"
        tabIndex={-1}
        className="text-h1 font-bold text-petroleo outline-none"
      >
        {title}
      </h1>
      <p className="mt-2 text-body text-muted-foreground">{description}</p>
    </div>
  );

  return (
    <QuestionStack className="pb-4">
      {section === 0 && (
        <section className="flex flex-col gap-6" aria-labelledby="step2-title">
          {sectionHeader('Seus objetivos', 'Pra onde estamos indo.')}
          <ChoiceGroup<PrimaryGoal>
            legend="Qual é o seu principal objetivo?"
            items={GOAL_ITEMS}
            selected={data.primaryGoal ? [data.primaryGoal] : []}
            onToggle={(primaryGoal) => set('primaryGoal', primaryGoal)}
            stack
            indicatorSide="left"
          />
          {data.primaryGoal === 'OTHER' && (
            <QuestionField className="border-l-2 border-primary pl-4" aria-live="polite">
              <FieldLabel htmlFor="goalOther">
                Conta em poucas palavras qual é seu objetivo.
              </FieldLabel>
              <TextArea
                id="goalOther"
                value={data.primaryGoalOther}
                maxLength={120}
                onChange={(value) => set('primaryGoalOther', value)}
              />
            </QuestionField>
          )}
          <EmphasisRegionGrid
            selected={visibleEmphasis}
            onToggle={(region) => toggleEmphasis(region)}
          />
          <QuestionStack>
            <YesNo
              legend="Existe alguma data ou evento importante relacionado ao seu objetivo?"
              value={data.hasImportantEvent}
              onChange={(value) => set('hasImportantEvent', value)}
            />
            {data.hasImportantEvent && (
              <QuestionStack className="border-l-2 border-primary pl-4" aria-live="polite">
                <QuestionField>
                  <FieldLabel htmlFor="eventDate">Qual é a data?</FieldLabel>
                  <DatePicker
                    id="eventDate"
                    value={data.importantEventDate}
                    onChange={(value) => set('importantEventDate', value)}
                    minDate={firstEventDate}
                    maxDate={null}
                  />
                </QuestionField>
                <QuestionField>
                  <FieldLabel htmlFor="eventDescription">
                    Qual é o evento ou resultado esperado?
                  </FieldLabel>
                  <TextArea
                    id="eventDescription"
                    value={data.importantEventDescription}
                    onChange={(value) => set('importantEventDescription', value)}
                    maxLength={300}
                  />
                </QuestionField>
              </QuestionStack>
            )}
          </QuestionStack>
        </section>
      )}

      {section === 1 && (
        <section className="flex flex-col gap-6" aria-labelledby="step2-title">
          {sectionHeader('Seu histórico', 'De onde você está partindo.')}
          <ChoiceGroup<TrainingStatus>
            legend="Você treina atualmente?"
            items={STATUS_ITEMS}
            selected={data.trainingStatus ? [data.trainingStatus] : []}
            onToggle={(value) => set('trainingStatus', value)}
            stack
            indicatorSide="left"
          />
          {data.trainingStatus === 'STOPPED' && (
            <div className="border-l-2 border-primary pl-4" aria-live="polite">
              <ChoiceGroup<StoppedFor>
                legend="Há quanto tempo você não treina?"
                items={STOPPED_FOR_ITEMS}
                selected={data.stoppedFor ? [data.stoppedFor] : []}
                onToggle={(value) => set('stoppedFor', value)}
                stack
                indicatorSide="left"
              />
            </div>
          )}
          <Combobox<TrainingExperience>
            id="trainingExperience"
            legend="Qual é a sua experiência com musculação?"
            items={EXPERIENCE_ITEMS}
            value={data.experience}
            onChange={(value) => set('experience', value)}
            placeholder="Selecione sua experiência"
          />
          <ChoiceGroup<PastActivity>
            legend="Quais atividades você pratica ou já praticou?"
            items={ACTIVITY_ITEMS}
            selected={data.pastActivities}
            onToggle={toggleActivity}
            multi
            disabledValues={
              data.pastActivities.includes('NONE') ? ACTIVITY_VALUES_EXCEPT_NONE : undefined
            }
            stack
            indicatorSide="left"
          />
          {data.pastActivities.includes('OTHER') && (
            <QuestionField className="border-l-2 border-primary pl-4" aria-live="polite">
              <FieldLabel htmlFor="activityOther">Qual atividade?</FieldLabel>
              <TextInput
                id="activityOther"
                value={data.pastActivityOther}
                onChange={(value) => set('pastActivityOther', value)}
                maxLength={120}
              />
            </QuestionField>
          )}
          <ChoiceGroup<ConsistencyBarrier>
            legend="O que mais dificultou sua consistência nos treinos anteriormente?"
            items={BARRIER_ITEMS}
            selected={data.consistencyBarriers}
            onToggle={(value) => toggleArray('consistencyBarriers', value)}
            multi
            stack
            indicatorSide="left"
          />
          {data.consistencyBarriers.includes('OTHER') && (
            <QuestionField className="border-l-2 border-primary pl-4" aria-live="polite">
              <FieldLabel htmlFor="barrierOther">Qual dificuldade?</FieldLabel>
              <TextInput
                id="barrierOther"
                value={data.consistencyBarrierOther}
                onChange={(value) => set('consistencyBarrierOther', value)}
                maxLength={120}
              />
            </QuestionField>
          )}
        </section>
      )}

      {section === 2 && (
        <section className="flex flex-col gap-6" aria-labelledby="step2-title">
          {sectionHeader('Sua rotina', 'O que cabe na sua semana de verdade.')}
          <Combobox
            id="daysPerWeek"
            legend="Quantos dias por semana você consegue treinar?"
            items={DAYS_ITEMS}
            value={data.daysPerWeek ? String(data.daysPerWeek) : null}
            onChange={(value) => set('daysPerWeek', Number(value))}
            placeholder="Selecione a quantidade de dias"
          />
          <ChoiceGroup<Weekday>
            legend="Quais dias da semana você consegue treinar?"
            items={WEEKDAY_ITEMS}
            selected={data.preferredDays}
            onToggle={(value) => toggleArray('preferredDays', value)}
            multi
            stack
            indicatorSide="left"
          />
          <ChoiceGroup<SessionDuration>
            legend="Quanto tempo você tem disponível por treino?"
            items={DURATION_ITEMS}
            selected={data.sessionDuration ? [data.sessionDuration] : []}
            onToggle={(value) => set('sessionDuration', value)}
            stack
            indicatorSide="left"
          />
          <ChoiceGroup<TrainingLocation>
            legend="Onde você pretende treinar?"
            items={LOCATION_ITEMS}
            selected={data.location ? [data.location] : []}
            onToggle={(value) => set('location', value)}
            indicatorSide="left"
          />
          <ChoiceGroup<PreferredPeriod>
            legend="Em qual período você prefere treinar?"
            items={PERIOD_ITEMS}
            selected={data.preferredPeriod ? [data.preferredPeriod] : []}
            onToggle={(value) => set('preferredPeriod', value)}
            indicatorSide="left"
          />
        </section>
      )}

      {section === 3 && (
        <section className="flex flex-col gap-6" aria-labelledby="step2-title">
          {sectionHeader('Dores e limitações', 'Isso é o que mantém seu treino seguro.')}
          <PainSection data={data.pain} onChange={(pain) => set('pain', pain)} />
        </section>
      )}

      {section === 4 && (
        <section className="flex flex-col gap-6" aria-labelledby="step2-title">
          {sectionHeader('Suas preferências', 'O que você prefere não fazer.')}
          <QuestionStack>
            <YesNo
              legend="Existe algum exercício que você não gosta ou não deseja realizar?"
              value={data.hasAvoidedExercise}
              onChange={(value) => set('hasAvoidedExercise', value)}
              indicatorSide="left"
            />
            {data.hasAvoidedExercise && (
              <QuestionField className="border-l-2 border-primary pl-4" aria-live="polite">
                <FieldLabel htmlFor="avoidedExercise">
                  Qual exercício você prefere evitar?
                </FieldLabel>
                <TextArea
                  id="avoidedExercise"
                  value={data.avoidedExercise}
                  onChange={(value) => set('avoidedExercise', value)}
                  maxLength={300}
                />
              </QuestionField>
            )}
          </QuestionStack>
        </section>
      )}

      <div className="sticky bottom-0 z-10 -mx-5 mt-1 flex flex-col-reverse gap-3 border-t border-border bg-white/95 px-5 py-4 backdrop-blur-sm sm:static sm:mx-0 sm:flex-row sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:backdrop-blur-none">
        {(section > 0 || onBack) && (
          <button
            type="button"
            onClick={() => (section > 0 ? navigate(section - 1) : onBack?.())}
            disabled={saving}
            className="h-[52px] flex-1 rounded-xl border border-input bg-white px-6 text-body font-semibold text-petroleo transition-colors hover:bg-secondary disabled:opacity-50"
          >
            Voltar
          </button>
        )}
        <button
          type="button"
          disabled={!sectionComplete || saving}
          onClick={() => (section < 4 ? navigate(section + 1) : onContinue())}
          className="h-[52px] flex-1 rounded-xl bg-primary px-6 text-body font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:pointer-events-none disabled:bg-muted disabled:text-muted-foreground"
        >
          {saving ? 'Salvando…' : section === 4 ? 'Continuar para saúde' : 'Continuar'}
        </button>
      </div>
    </QuestionStack>
  );
}

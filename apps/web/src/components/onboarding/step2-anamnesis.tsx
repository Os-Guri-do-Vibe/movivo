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

import { ChoiceGroup, FieldLabel, TextArea, TextInput, YesNo } from './fields';
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
  practicesOtherSport: boolean;
  otherSportDaysPerWeek: number | null;
  otherSportName: string;

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
  practicesOtherSport: false,
  otherSportDaysPerWeek: null,
  otherSportName: '',
  hasAvoidedExercise: false,
  avoidedExercise: '',
  pain: EMPTY_PAIN,
};

const GOAL_ITEMS = (Object.keys(PRIMARY_GOAL_LABELS) as PrimaryGoal[]).map((value) => ({
  value,
  label: PRIMARY_GOAL_LABELS[value],
}));

const EMPHASIS_ITEMS = (Object.keys(EMPHASIS_REGION_LABELS) as EmphasisRegion[]).map((value) => ({
  value,
  label: EMPHASIS_REGION_LABELS[value],
}));

const STATUS_ITEMS: { value: TrainingStatus; label: string }[] = [
  { value: 'NEVER', label: 'Nunca treinei' },
  { value: 'STOPPED', label: 'Estou parado' },
  { value: 'OCCASIONAL', label: 'Treino ocasionalmente' },
  { value: 'REGULAR', label: 'Treino regularmente' },
];

const STOPPED_FOR_ITEMS: { value: StoppedFor; label: string }[] = [
  { value: 'LT_3_MONTHS', label: 'Menos de 1 mês' },
  { value: 'M3_TO_6', label: 'Entre 1 e 3 meses' },
  { value: 'M6_TO_12', label: 'Entre 4 e 6 meses' },
  { value: 'Y1_TO_2', label: 'Entre 7 e 12 meses' },
  { value: 'GT_2_YEARS', label: 'Mais de 1 ano' },
];

/** Copy literal do fundador — descrições dos 3 níveis (não parafrasear). */
const EXPERIENCE_ITEMS: { value: TrainingExperience; label: string }[] = [
  { value: 'BEGINNER', label: 'Iniciante — nunca treinei ou ainda preciso de bastante orientação' },
  {
    value: 'INTERMEDIATE',
    label: 'Intermediário — conheço os principais exercícios e já treinei com regularidade',
  },
  {
    value: 'ADVANCED',
    label: 'Avançado — treino consistentemente e tenho experiência com controle de cargas',
  },
];

const ACTIVITY_ITEMS: { value: PastActivity; label: string }[] = [
  { value: 'WEIGHT_TRAINING', label: 'Musculação' },
  { value: 'WALK_RUN', label: 'Corrida' },
  { value: 'CYCLING', label: 'Ciclismo' },
  { value: 'FUNCTIONAL_CROSSFIT', label: 'Treino funcional / Cross training' },
  { value: 'FOOTBALL', label: 'Esportes coletivos' },
  { value: 'MARTIAL_ARTS', label: 'Lutas' },
  { value: 'DANCE', label: 'Dança' },
  { value: 'YOGA_PILATES', label: 'Pilates' },
  { value: 'SWIMMING', label: 'Natação' },
  { value: 'NONE', label: 'Nenhuma' },
  { value: 'OTHER', label: 'Outra' },
];

const BARRIER_ITEMS: { value: ConsistencyBarrier; label: string }[] = [
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

const WEEKDAY_ITEMS: { value: Weekday; label: string }[] = [
  { value: 'MON', label: 'Segunda' },
  { value: 'TUE', label: 'Terça' },
  { value: 'WED', label: 'Quarta' },
  { value: 'THU', label: 'Quinta' },
  { value: 'FRI', label: 'Sexta' },
  { value: 'SAT', label: 'Sábado' },
  { value: 'SUN', label: 'Domingo' },
];

const DURATION_ITEMS: { value: SessionDuration; label: string }[] = [
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

const PERIOD_ITEMS: { value: PreferredPeriod; label: string }[] = [
  { value: 'MORNING', label: 'Manhã' },
  { value: 'AFTERNOON', label: 'Tarde' },
  { value: 'NIGHT', label: 'Noite' },
  { value: 'VARIES', label: 'Varia conforme o dia' },
];

export function Step2Anamnesis({
  data,
  onChange,
  onContinue,
  saving,
}: {
  data: Step2State;
  onChange: (data: Step2State) => void;
  onContinue: () => void;
  saving: boolean;
}) {
  function set<K extends keyof Step2State>(key: K, value: Step2State[K]) {
    onChange({ ...data, [key]: value });
  }

  function toggleEmphasis(region: EmphasisRegion) {
    if (region === 'FULL_BODY') {
      set('emphasis', data.emphasis.includes('FULL_BODY') ? [] : ['FULL_BODY']);
      return;
    }
    const withoutFullBody = data.emphasis.filter((r) => r !== 'FULL_BODY');
    const exists = withoutFullBody.includes(region);
    set(
      'emphasis',
      exists
        ? withoutFullBody.filter((r) => r !== region)
        : [...withoutFullBody, region].slice(0, 2),
    );
  }

  function toggleActivity(value: PastActivity) {
    set(
      'pastActivities',
      data.pastActivities.includes(value)
        ? data.pastActivities.filter((v) => v !== value)
        : [...data.pastActivities, value],
    );
  }

  function toggleBarrier(value: ConsistencyBarrier) {
    set(
      'consistencyBarriers',
      data.consistencyBarriers.includes(value)
        ? data.consistencyBarriers.filter((v) => v !== value)
        : [...data.consistencyBarriers, value],
    );
  }

  function toggleDay(value: Weekday) {
    set(
      'preferredDays',
      data.preferredDays.includes(value)
        ? data.preferredDays.filter((v) => v !== value)
        : [...data.preferredDays, value],
    );
  }

  const canContinue =
    data.primaryGoal !== null &&
    (data.primaryGoal !== 'OTHER' || data.primaryGoalOther.trim().length > 0) &&
    data.trainingStatus !== null &&
    (data.trainingStatus !== 'STOPPED' || data.stoppedFor !== null) &&
    data.experience !== null &&
    data.daysPerWeek !== null &&
    data.sessionDuration !== null &&
    data.location !== null &&
    data.preferredPeriod !== null &&
    (!data.pain.hasPain || (data.pain.points.length > 0 && data.pain.trend !== null)) &&
    !saving;

  return (
    <div className="flex flex-col gap-10">
      <div>
        <p className="font-mono text-label text-muted-foreground">Etapa 2 de 3</p>
        <h1 className="text-h1 font-bold">Conte um pouco sobre você</h1>
        <p className="mt-2 text-body text-muted-foreground">
          Suas respostas ajudarão a MOVIVO a adaptar o treino aos seus objetivos, experiência e
          rotina.
        </p>
      </div>

      <section className="flex flex-col gap-6">
        <h2 className="text-h2 font-semibold">Seção 1 — Seus objetivos</h2>

        <ChoiceGroup<PrimaryGoal>
          legend="Qual é o seu principal objetivo?"
          items={GOAL_ITEMS}
          selected={data.primaryGoal ? [data.primaryGoal] : []}
          onToggle={(primaryGoal) => set('primaryGoal', primaryGoal)}
          columns
        />
        {data.primaryGoal === 'OTHER' && (
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="goalOther">Conte para nós qual é o seu objetivo</FieldLabel>
            <TextArea
              id="goalOther"
              value={data.primaryGoalOther}
              onChange={(primaryGoalOther) => set('primaryGoalOther', primaryGoalOther)}
            />
          </div>
        )}

        <ChoiceGroup<EmphasisRegion>
          legend="Em quais regiões você gostaria de dar mais ênfase? (até 2)"
          items={EMPHASIS_ITEMS}
          selected={data.emphasis}
          onToggle={toggleEmphasis}
          multi
          disabledValues={
            data.emphasis.length >= 2 || data.emphasis.includes('FULL_BODY')
              ? (Object.keys(EMPHASIS_REGION_LABELS) as EmphasisRegion[])
              : []
          }
          columns
        />

        <YesNo
          legend="Existe alguma data ou evento importante relacionado ao seu objetivo?"
          value={data.hasImportantEvent}
          onChange={(hasImportantEvent) => set('hasImportantEvent', hasImportantEvent)}
        />
        {data.hasImportantEvent && (
          <>
            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor="eventDate">Qual é a data?</FieldLabel>
              <TextInput
                id="eventDate"
                type="date"
                value={data.importantEventDate}
                onChange={(importantEventDate) => set('importantEventDate', importantEventDate)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <FieldLabel htmlFor="eventDescription">
                Qual é o evento ou resultado esperado?
              </FieldLabel>
              <TextArea
                id="eventDescription"
                value={data.importantEventDescription}
                onChange={(importantEventDescription) =>
                  set('importantEventDescription', importantEventDescription)
                }
              />
            </div>
          </>
        )}
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-h2 font-semibold">Seção 2 — Seu histórico</h2>

        <ChoiceGroup<TrainingStatus>
          legend="Você treina atualmente?"
          items={STATUS_ITEMS}
          selected={data.trainingStatus ? [data.trainingStatus] : []}
          onToggle={(trainingStatus) => set('trainingStatus', trainingStatus)}
        />
        {data.trainingStatus === 'STOPPED' && (
          <ChoiceGroup<StoppedFor>
            legend="Há quanto tempo você não treina?"
            items={STOPPED_FOR_ITEMS}
            selected={data.stoppedFor ? [data.stoppedFor] : []}
            onToggle={(stoppedFor) => set('stoppedFor', stoppedFor)}
          />
        )}

        <ChoiceGroup<TrainingExperience>
          legend="Qual é a sua experiência com musculação?"
          items={EXPERIENCE_ITEMS}
          selected={data.experience ? [data.experience] : []}
          onToggle={(experience) => set('experience', experience)}
        />

        <ChoiceGroup<PastActivity>
          legend="Quais atividades você pratica ou já praticou?"
          items={ACTIVITY_ITEMS}
          selected={data.pastActivities}
          onToggle={toggleActivity}
          multi
          columns
        />
        {data.pastActivities.includes('OTHER') && (
          <TextInput
            id="activityOther"
            value={data.pastActivityOther}
            onChange={(pastActivityOther) => set('pastActivityOther', pastActivityOther)}
            placeholder="Qual atividade?"
          />
        )}

        <ChoiceGroup<ConsistencyBarrier>
          legend="O que mais dificultou sua consistência nos treinos anteriormente?"
          items={BARRIER_ITEMS}
          selected={data.consistencyBarriers}
          onToggle={toggleBarrier}
          multi
          columns
        />
        {data.consistencyBarriers.includes('OTHER') && (
          <TextInput
            id="barrierOther"
            value={data.consistencyBarrierOther}
            onChange={(consistencyBarrierOther) =>
              set('consistencyBarrierOther', consistencyBarrierOther)
            }
            placeholder="Qual dificuldade?"
          />
        )}
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-h2 font-semibold">Seção 3 — Sua rotina</h2>

        <ChoiceGroup
          legend="Quantos dias por semana você consegue treinar?"
          items={DAYS_ITEMS}
          selected={data.daysPerWeek ? [String(data.daysPerWeek)] : []}
          onToggle={(v) => set('daysPerWeek', Number(v))}
        />

        <ChoiceGroup<Weekday>
          legend="Quais dias da semana você consegue treinar?"
          items={WEEKDAY_ITEMS}
          selected={data.preferredDays}
          onToggle={toggleDay}
          multi
          columns
        />

        <ChoiceGroup<SessionDuration>
          legend="Quanto tempo você tem disponível por treino?"
          items={DURATION_ITEMS}
          selected={data.sessionDuration ? [data.sessionDuration] : []}
          onToggle={(sessionDuration) => set('sessionDuration', sessionDuration)}
        />

        <ChoiceGroup<TrainingLocation>
          legend="Onde você pretende treinar?"
          items={LOCATION_ITEMS}
          selected={data.location ? [data.location] : []}
          onToggle={(location) => set('location', location)}
        />

        <ChoiceGroup<PreferredPeriod>
          legend="Em qual período você prefere treinar?"
          items={PERIOD_ITEMS}
          selected={data.preferredPeriod ? [data.preferredPeriod] : []}
          onToggle={(preferredPeriod) => set('preferredPeriod', preferredPeriod)}
        />

        <YesNo
          legend="Você pratica atualmente outro esporte ou atividade física?"
          value={data.practicesOtherSport}
          onChange={(practicesOtherSport) => set('practicesOtherSport', practicesOtherSport)}
        />
        {data.practicesOtherSport && (
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="otherSport">
              Qual atividade você pratica e em quantos dias por semana?
            </FieldLabel>
            <TextInput
              id="otherSport"
              value={data.otherSportName}
              onChange={(otherSportName) => set('otherSportName', otherSportName)}
              placeholder="Atividade"
            />
            <ChoiceGroup
              items={[1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: String(n) }))}
              selected={data.otherSportDaysPerWeek ? [String(data.otherSportDaysPerWeek)] : []}
              onToggle={(v) => set('otherSportDaysPerWeek', Number(v))}
            />
          </div>
        )}
      </section>

      <PainSection data={data.pain} onChange={(pain) => set('pain', pain)} />

      <section className="flex flex-col gap-6">
        <h2 className="text-h2 font-semibold">Seção 5 — Suas preferências</h2>
        <YesNo
          legend="Existe algum exercício que você não gosta ou não deseja realizar?"
          value={data.hasAvoidedExercise}
          onChange={(hasAvoidedExercise) => set('hasAvoidedExercise', hasAvoidedExercise)}
        />
        {data.hasAvoidedExercise && (
          <div className="flex flex-col gap-2">
            <FieldLabel htmlFor="avoidedExercise">Qual exercício você prefere evitar?</FieldLabel>
            <TextArea
              id="avoidedExercise"
              value={data.avoidedExercise}
              onChange={(avoidedExercise) => set('avoidedExercise', avoidedExercise)}
            />
          </div>
        )}
      </section>

      <button
        type="button"
        disabled={!canContinue}
        onClick={onContinue}
        className="h-11 rounded-lg bg-primary px-6 text-body font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
      >
        {saving ? 'Salvando…' : 'CONTINUAR'}
      </button>
    </div>
  );
}

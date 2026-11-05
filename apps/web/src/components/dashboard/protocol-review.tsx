'use client';

/**
 * Revisão do protocolo na fila: o profissional vê o plano inteiro (com a semana simulada),
 * edita à mão o que precisar ou pede um novo protocolo aos agentes com uma orientação. Aprovar
 * e recusar continuam na seção de decisão do caso. O servidor confere toda edição.
 */
import { useCallback, useState } from 'react';

import {
  editProtocolRequestSchema,
  HYROX_STATION_LABELS,
  MEAL_SLOT_LABELS,
  RUNNING_SESSION_KIND_LABELS,
  SESSION_MODALITY_LABELS,
  SESSION_PRIORITY_LABELS,
  type DailyTargets,
  type MealItem,
  type MealOption,
  type NutritionPlanStructure,
  type PlanSession,
  type ProtocolReview as Protocol,
  type StrengthExercise,
  type TrainingPlanStructure,
} from '@movivo/shared';

import { Button } from '@/components/ui/button';
import { MealMenu } from '@/components/plano/meal-menu';
import { brl, OPTION_LETTERS } from '@/lib/meal-menu';
import {
  amendActiveProtocol,
  getActiveProtocol,
  getExceptionProtocol,
  ProtocolEditError,
  requestProtocolAdjustment,
  saveExceptionProtocol,
} from '@/lib/control-center-api';

import { ConfirmAction } from './confirm-action';
import { ResourceState, useControlCenterResource } from './control-center-ui';

type TrainingProtocol = Extract<Protocol, { kind: 'TRAINING' }>;
type ExerciseOption = TrainingProtocol['exerciseOptions'][number];

const LOAD_LABELS: Record<StrengthExercise['loadStrategy'], string> = {
  BODYWEIGHT: 'Peso corporal',
  FIXED_LOAD: 'Carga fixa',
  DOUBLE_PROGRESSION: 'Dupla progressão',
  RIR: 'Por reserva (RIR)',
};
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const SLOTS: Record<string, string> = { MORNING: 'manhã', AFTERNOON: 'tarde', EVENING: 'noite' };
const field =
  'mt-1 w-full rounded-md border border-input bg-card px-2 py-1 text-label text-foreground';
const card = 'rounded-xl border border-border bg-card p-4 sm:p-5';

function day(date: string, slot: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const label = `${WEEKDAYS[d.getUTCDay()] ?? ''} ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return SLOTS[slot] ? `${label} · ${SLOTS[slot]}` : label;
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min: number;
  max: number;
  step?: number;
}) {
  return (
    <label className="block text-xs text-muted-foreground">
      {label}
      <input
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={value ?? ''}
        onChange={(event) =>
          onChange(event.target.value === '' ? undefined : Number(event.target.value))
        }
        className={field}
      />
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  rows,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  maxLength: number;
}) {
  return (
    <label className="block text-xs text-muted-foreground">
      {label}
      {rows ? (
        <textarea
          rows={rows}
          maxLength={maxLength}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={field}
        />
      ) : (
        <input
          maxLength={maxLength}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={field}
        />
      )}
    </label>
  );
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

function sessionSummary(session: PlanSession): string[] {
  const { content } = session;
  if (content.modality === 'STRENGTH') {
    return content.exercises.map(
      (e) =>
        `${e.name} — ${e.sets} × ${e.durationSeconds ? `${e.durationSeconds} s` : `${e.reps?.min ?? ''}–${e.reps?.max ?? ''}`} · descanso ${e.restSeconds} s${e.rir !== undefined ? ` · RIR ${e.rir}` : ''} · ${LOAD_LABELS[e.loadStrategy]}`,
    );
  }
  if (content.modality === 'RUNNING') {
    return [RUNNING_SESSION_KIND_LABELS[content.kind]].concat(
      content.segments.map(
        (s) =>
          `${s.repeat && s.repeat > 1 ? `${s.repeat} × ` : ''}${s.distanceMeters ? `${s.distanceMeters} m` : `${Math.round((s.durationSeconds ?? 0) / 60)} min`} (${s.type})`,
      ),
    );
  }
  if (content.modality === 'HYROX') {
    return content.blocks.map((b) =>
      b.type === 'STATION'
        ? HYROX_STATION_LABELS[b.station]
        : b.type === 'RUN'
          ? `Corrida ${b.distanceMeters} m`
          : `Pausa ${b.durationSeconds} s`,
    );
  }
  return [`Esporte externo: ${content.label} · ${content.plannedMinutes} min`];
}

function TrainingView({ protocol }: { protocol: TrainingProtocol }) {
  const { structure, weekPreview } = protocol;
  return (
    <div className="space-y-4">
      <p className="text-label">{structure.summary}</p>
      <div>
        <h3 className="text-label font-semibold">Primeira semana (simulada a partir de hoje)</h3>
        {weekPreview.sessions.length > 0 ? (
          <ul className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
            {weekPreview.sessions.map((s) => (
              <li key={`${s.date}-${s.sessionKey}-${s.occurrence}`}>
                <span className="font-medium">{day(s.date, s.slot)}</span> · {s.title}
                <span className="text-muted-foreground">
                  {' '}
                  ({SESSION_MODALITY_LABELS[s.modality]})
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">Nenhuma sessão coube nesta semana.</p>
        )}
        {weekPreview.dropped.length > 0 ? (
          <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
            {weekPreview.dropped.map((d, i) => (
              <li key={`${d.sessionKey}-${i}`}>
                Ficou fora: {d.title} — {d.reason}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div>
        <h3 className="text-label font-semibold">Fases</h3>
        <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
          {structure.phases.map((p) => (
            <li key={p.name}>
              {p.name} · {p.weeks} sem. · {p.focus}
              {p.endsWithDeload ? ' · termina com semana leve' : ''}
            </li>
          ))}
        </ul>
      </div>
      {structure.sessions.map((session) => (
        <div key={session.key} className="rounded-lg border border-border p-3">
          <p className="text-label font-medium">
            {session.title}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {SESSION_MODALITY_LABELS[session.content.modality]} ·{' '}
              {SESSION_PRIORITY_LABELS[session.priority]} · {session.weeklyFrequency}×/sem ·{' '}
              {session.estimatedMinutes} min
            </span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{session.purpose}</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs">
            {sessionSummary(session).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Targets({ label, targets }: { label: string; targets: DailyTargets }) {
  return (
    <div className="rounded-lg border border-border p-3 text-xs">
      <p className="text-label font-medium">{label}</p>
      <p className="mt-1">
        {targets.energyKcal.min}–{targets.energyKcal.max} kcal · P {targets.proteinG} g · C{' '}
        {targets.carbsG} g · G {targets.fatG} g · fibras {targets.fiberG} g · água {targets.waterMl}{' '}
        ml
      </p>
    </div>
  );
}

function NutritionView({ structure }: { structure: NutritionPlanStructure }) {
  return (
    <div className="space-y-4">
      <p className="text-label">{structure.summary}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Targets label="Dia de treino" targets={structure.trainingDay} />
        <Targets label="Dia de descanso" targets={structure.restDay} />
      </div>
      {structure.meals.map((meal) => (
        <div key={meal.slot} className="rounded-lg border border-border p-3 text-xs">
          <p className="text-label font-medium">
            {MEAL_SLOT_LABELS[meal.slot]}
            <span className="ml-2 font-normal text-muted-foreground">
              {Math.round(meal.energyShare * 100)}% da energia · {meal.proteinG} g de proteína
            </span>
          </p>
          <p className="mt-1">{meal.guidance}</p>
          <MealMenu meal={meal} />
        </div>
      ))}
      {structure.estimatedDailyCostBrl ? (
        <p className="text-xs text-muted-foreground">
          Custo estimado do cardápio: ~{brl(structure.estimatedDailyCostBrl)} por dia (~
          {brl(structure.estimatedDailyCostBrl * 30)} no mês), estimativa do nutricionista de IA.
        </p>
      ) : null}
      {structure.freeMeals ? (
        <div>
          <h3 className="text-label font-semibold">
            Refeições livres · {structure.freeMeals.perWeek}x por semana
          </h3>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {structure.freeMeals.options.map((o) => (
              <li key={o.title}>
                <strong>{o.title}</strong>: {o.description} (~{o.energyKcal} kcal). {o.fitTip}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <h3 className="text-label font-semibold">Orientações</h3>
        <ul className="mt-1 list-disc pl-5 text-xs">
          {structure.guidelines.map((g) => (
            <li key={g}>{g}</li>
          ))}
        </ul>
      </div>
      {structure.supplements.length > 0 ? (
        <div>
          <h3 className="text-label font-semibold">Suplementos</h3>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {structure.supplements.map((s) => (
              <li key={s.name}>
                {s.name}: {s.guidance}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ExerciseEditor({
  exercise,
  options,
  onChange,
}: {
  exercise: StrengthExercise;
  options: readonly ExerciseOption[];
  onChange: (exercise: StrengthExercise) => void;
}) {
  const known = options.some((o) => o.id === exercise.exerciseId);
  const swap = (id: string) => {
    const option = options.find((o) => o.id === id);
    if (!option) return;
    const byTime = option.measurement === 'DURATION';
    onChange({
      ...exercise,
      exerciseId: option.id,
      name: option.name,
      reps: byTime ? undefined : (exercise.reps ?? { min: 8, max: 12 }),
      durationSeconds: byTime ? (exercise.durationSeconds ?? 30) : undefined,
    });
  };
  return (
    <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-6">
      <label className="block text-xs text-muted-foreground sm:col-span-6">
        Exercício
        <select
          value={exercise.exerciseId}
          onChange={(event) => swap(event.target.value)}
          className={field}
        >
          {known ? null : <option value={exercise.exerciseId}>{exercise.name}</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <NumberField
        label="Séries"
        value={exercise.sets}
        min={1}
        max={12}
        onChange={(sets) => onChange({ ...exercise, sets: sets ?? 1 })}
      />
      {exercise.durationSeconds !== undefined ? (
        <NumberField
          label="Duração (s)"
          value={exercise.durationSeconds}
          min={5}
          max={3600}
          onChange={(durationSeconds) =>
            onChange({ ...exercise, durationSeconds: durationSeconds ?? 5 })
          }
        />
      ) : (
        <>
          <NumberField
            label="Reps mín."
            value={exercise.reps?.min}
            min={1}
            max={100}
            onChange={(min) =>
              onChange({ ...exercise, reps: { min: min ?? 1, max: exercise.reps?.max ?? 1 } })
            }
          />
          <NumberField
            label="Reps máx."
            value={exercise.reps?.max}
            min={1}
            max={100}
            onChange={(max) =>
              onChange({ ...exercise, reps: { min: exercise.reps?.min ?? 1, max: max ?? 1 } })
            }
          />
        </>
      )}
      <NumberField
        label="Descanso (s)"
        value={exercise.restSeconds}
        min={0}
        max={600}
        step={15}
        onChange={(restSeconds) => onChange({ ...exercise, restSeconds: restSeconds ?? 0 })}
      />
      <NumberField
        label="RIR"
        value={exercise.rir}
        min={0}
        max={5}
        onChange={(rir) => onChange({ ...exercise, rir })}
      />
      <label className="block text-xs text-muted-foreground">
        Carga
        <select
          value={exercise.loadStrategy}
          onChange={(event) =>
            onChange({
              ...exercise,
              loadStrategy: event.target.value as StrengthExercise['loadStrategy'],
            })
          }
          className={field}
        >
          {Object.entries(LOAD_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="sm:col-span-6">
        <TextField
          label="Observação ao aluno"
          value={exercise.notes ?? ''}
          maxLength={400}
          onChange={(notes) => onChange({ ...exercise, notes: notes || undefined })}
        />
      </div>
    </div>
  );
}

function TrainingEditor({
  structure,
  options,
  onChange,
}: {
  structure: TrainingPlanStructure;
  options: readonly ExerciseOption[];
  onChange: (structure: TrainingPlanStructure) => void;
}) {
  const setSession = (index: number, session: PlanSession) =>
    onChange({
      ...structure,
      sessions: structure.sessions.map((s, i) => (i === index ? session : s)),
    });
  return (
    <div className="space-y-4">
      {structure.sessions.map((session, si) => (
        <fieldset key={session.key} className="space-y-2 rounded-lg border border-border p-3">
          <legend className="px-1 text-label font-medium">{session.title}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            <TextField
              label="Título"
              value={session.title}
              maxLength={80}
              onChange={(title) => setSession(si, { ...session, title })}
            />
            <NumberField
              label="Vezes por semana"
              value={session.weeklyFrequency}
              min={1}
              max={7}
              onChange={(weeklyFrequency) =>
                setSession(si, { ...session, weeklyFrequency: weeklyFrequency ?? 1 })
              }
            />
            <NumberField
              label="Duração estimada (min)"
              value={session.estimatedMinutes}
              min={5}
              max={300}
              step={5}
              onChange={(estimatedMinutes) =>
                setSession(si, { ...session, estimatedMinutes: estimatedMinutes ?? 5 })
              }
            />
          </div>
          {session.content.modality === 'STRENGTH'
            ? session.content.exercises.map((exercise, ei) => (
                <ExerciseEditor
                  key={`${ei}-${exercise.exerciseId}`}
                  exercise={exercise}
                  options={options}
                  onChange={(next) => {
                    if (session.content.modality !== 'STRENGTH') return;
                    setSession(si, {
                      ...session,
                      content: {
                        ...session.content,
                        exercises: session.content.exercises.map((e, i) => (i === ei ? next : e)),
                      },
                    });
                  }}
                />
              ))
            : null}
        </fieldset>
      ))}
    </div>
  );
}

function TargetsEditor({
  label,
  targets,
  onChange,
}: {
  label: string;
  targets: DailyTargets;
  onChange: (targets: DailyTargets) => void;
}) {
  const set = (key: Exclude<keyof DailyTargets, 'energyKcal'>) => (value: number | undefined) =>
    onChange({ ...targets, [key]: value ?? 0 });
  return (
    <fieldset className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-4">
      <legend className="px-1 text-label font-medium">{label}</legend>
      <NumberField
        label="Energia mín. (kcal)"
        value={targets.energyKcal.min}
        min={800}
        max={6000}
        step={10}
        onChange={(min) =>
          onChange({ ...targets, energyKcal: { ...targets.energyKcal, min: min ?? 800 } })
        }
      />
      <NumberField
        label="Energia máx. (kcal)"
        value={targets.energyKcal.max}
        min={800}
        max={6000}
        step={10}
        onChange={(max) =>
          onChange({ ...targets, energyKcal: { ...targets.energyKcal, max: max ?? 800 } })
        }
      />
      <NumberField
        label="Proteína (g)"
        value={targets.proteinG}
        min={30}
        max={400}
        onChange={set('proteinG')}
      />
      <NumberField
        label="Carboidrato (g)"
        value={targets.carbsG}
        min={20}
        max={1000}
        onChange={set('carbsG')}
      />
      <NumberField
        label="Gordura (g)"
        value={targets.fatG}
        min={20}
        max={300}
        onChange={set('fatG')}
      />
      <NumberField
        label="Fibras (g)"
        value={targets.fiberG}
        min={10}
        max={80}
        onChange={set('fiberG')}
      />
      <NumberField
        label="Água (ml)"
        value={targets.waterMl}
        min={1000}
        max={8000}
        step={100}
        onChange={set('waterMl')}
      />
    </fieldset>
  );
}

type FoodOption = NonNullable<Extract<Protocol, { kind: 'NUTRITION' }>['foodOptions']>[number];

function FoodSelect({
  value,
  name,
  foods,
  onChange,
}: {
  value: string;
  name: string;
  foods: readonly FoodOption[];
  onChange: (food: FoodOption) => void;
}) {
  const known = foods.some((f) => f.id === value);
  return (
    <select
      aria-label="Alimento"
      value={value}
      onChange={(event) => {
        const food = foods.find((f) => f.id === event.target.value);
        if (food) onChange(food);
      }}
      className={field}
    >
      {known ? null : <option value={value}>{name}</option>}
      {foods.map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </select>
  );
}

/** Uma opção de cardápio: título, custo estimado e alimentos com a quantidade e as trocas. */
function OptionEditor({
  index,
  option,
  foods,
  onChange,
}: {
  index: number;
  option: MealOption;
  foods: readonly FoodOption[];
  onChange: (option: MealOption) => void;
}) {
  const setItem = (ii: number, next: MealItem) =>
    onChange({ ...option, items: option.items.map((it, i) => (i === ii ? next : it)) });
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
        <TextField
          label={`Opção ${OPTION_LETTERS[index] ?? index + 1}: título`}
          value={option.title}
          maxLength={80}
          onChange={(title) => onChange({ ...option, title })}
        />
        <NumberField
          label="Custo estimado (R$)"
          value={option.estimatedCostBrl}
          min={0}
          max={300}
          step={0.5}
          onChange={(cost) => onChange({ ...option, estimatedCostBrl: cost ?? 0 })}
        />
      </div>
      {option.items.map((item, ii) => (
        <div key={ii} className="space-y-1.5 rounded-md bg-secondary/40 p-2">
          <div className="grid items-end gap-2 sm:grid-cols-[1fr_7rem_auto]">
            <label className="block text-xs text-muted-foreground">
              Alimento
              <FoodSelect
                value={item.foodId}
                name={item.name}
                foods={foods}
                onChange={(food) =>
                  setItem(ii, { ...item, foodId: food.id, name: food.name, swaps: [] })
                }
              />
            </label>
            <NumberField
              label="Quantidade (g)"
              value={item.grams}
              min={1}
              max={1500}
              onChange={(grams) => setItem(ii, { ...item, grams: grams ?? 1 })}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={option.items.length <= 1}
              onClick={() =>
                onChange({ ...option, items: option.items.filter((_, i) => i !== ii) })
              }
            >
              Remover
            </Button>
          </div>
          {item.unit ? (
            <p className="text-xs text-muted-foreground">
              Medida caseira: {item.unit.grams} g por {item.unit.singular}.
            </p>
          ) : null}
          {item.swaps.map((swap, si) => (
            <div key={si} className="grid items-end gap-2 sm:grid-cols-[1fr_auto]">
              <label className="block text-xs text-muted-foreground">
                Troca equivalente {si + 1} (a quantidade é calculada)
                <FoodSelect
                  value={swap.foodId}
                  name={swap.name}
                  foods={foods}
                  onChange={(food) =>
                    setItem(ii, {
                      ...item,
                      swaps: item.swaps.map((sw, i) =>
                        i === si ? { ...sw, foodId: food.id, name: food.name } : sw,
                      ),
                    })
                  }
                />
              </label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setItem(ii, { ...item, swaps: item.swaps.filter((_, i) => i !== si) })
                }
              >
                Remover troca
              </Button>
            </div>
          ))}
          {item.swaps.length < 3 && foods[0] ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setItem(ii, {
                  ...item,
                  swaps: [
                    ...item.swaps,
                    {
                      foodId: foods[0]?.id ?? '',
                      name: foods[0]?.name ?? '',
                      grams: 100,
                      energyKcal: 0,
                    },
                  ],
                })
              }
            >
              Adicionar troca
            </Button>
          ) : null}
        </div>
      ))}
      {option.items.length < 8 && foods[0] ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange({
              ...option,
              items: [
                ...option.items,
                {
                  foodId: foods[0]?.id ?? '',
                  name: foods[0]?.name ?? '',
                  grams: 100,
                  energyKcal: 0,
                  proteinG: 0,
                  carbsG: 0,
                  fatG: 0,
                  swaps: [],
                },
              ],
            })
          }
        >
          Adicionar alimento
        </Button>
      ) : null}
    </div>
  );
}

function NutritionEditor({
  structure,
  foods,
  onChange,
}: {
  structure: NutritionPlanStructure;
  foods: readonly FoodOption[];
  onChange: (structure: NutritionPlanStructure) => void;
}) {
  return (
    <div className="space-y-4">
      <TargetsEditor
        label="Dia de treino"
        targets={structure.trainingDay}
        onChange={(trainingDay) => onChange({ ...structure, trainingDay })}
      />
      <TargetsEditor
        label="Dia de descanso"
        targets={structure.restDay}
        onChange={(restDay) => onChange({ ...structure, restDay })}
      />
      {structure.meals.map((meal, mi) => {
        const setMeal = (next: typeof meal) =>
          onChange({ ...structure, meals: structure.meals.map((m, i) => (i === mi ? next : m)) });
        return (
          <fieldset
            key={meal.slot}
            className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-2"
          >
            <legend className="px-1 text-label font-medium">{MEAL_SLOT_LABELS[meal.slot]}</legend>
            <NumberField
              label="Parte da energia do dia (%)"
              value={Math.round(meal.energyShare * 100)}
              min={0}
              max={100}
              onChange={(pct) => setMeal({ ...meal, energyShare: (pct ?? 0) / 100 })}
            />
            <NumberField
              label="Proteína (g)"
              value={meal.proteinG}
              min={0}
              max={150}
              onChange={(proteinG) => setMeal({ ...meal, proteinG: proteinG ?? 0 })}
            />
            <div className="sm:col-span-2">
              <TextField
                label="Orientação"
                value={meal.guidance}
                rows={2}
                maxLength={300}
                onChange={(guidance) => setMeal({ ...meal, guidance })}
              />
            </div>
            {meal.options ? (
              <div className="space-y-3 sm:col-span-2">
                {meal.options.map((option, oi) => (
                  <OptionEditor
                    key={oi}
                    index={oi}
                    option={option}
                    foods={foods}
                    onChange={(next) =>
                      setMeal({
                        ...meal,
                        options: meal.options?.map((o, i) => (i === oi ? next : o)),
                      })
                    }
                  />
                ))}
                <p className="text-xs text-muted-foreground">
                  Os nutrientes, os totais e a quantidade das trocas são recalculados pelo servidor
                  ao salvar.
                </p>
              </div>
            ) : (
              <div className="sm:col-span-2">
                <TextField
                  label="Exemplos (um por linha, até 5)"
                  value={meal.examples.join('\n')}
                  rows={3}
                  maxLength={1100}
                  onChange={(text) => setMeal({ ...meal, examples: lines(text) })}
                />
              </div>
            )}
          </fieldset>
        );
      })}
      <TextField
        label="Orientações (uma por linha, até 10)"
        value={structure.guidelines.join('\n')}
        rows={5}
        maxLength={3100}
        onChange={(text) => onChange({ ...structure, guidelines: lines(text) })}
      />
    </div>
  );
}

/**
 * Com `caseId` é o protocolo em revisão de um caso da fila; com `amend` é o protocolo que o
 * aluno já usa (a edição vira a versão seguinte e o aluno recebe o protocolo atualizado).
 */
export function ProtocolReview({
  caseId,
  amend,
  canAct,
  onChanged,
}: {
  caseId?: string;
  amend?: { studentId: string; kind: 'TRAINING' | 'NUTRITION' };
  canAct: boolean;
  onChanged: () => Promise<void>;
}) {
  const amendStudentId = amend?.studentId;
  const amendKind = amend?.kind;
  const load = useCallback(
    (signal?: AbortSignal) =>
      amendStudentId && amendKind
        ? getActiveProtocol(amendStudentId, amendKind, signal)
        : getExceptionProtocol(caseId ?? '', signal),
    [caseId, amendStudentId, amendKind],
  );
  const { data, error, forbidden, loading, refresh } = useControlCenterResource(load);
  const [draft, setDraft] = useState<Protocol | null>(null);
  const [issues, setIssues] = useState<readonly string[]>([]);
  const [saving, setSaving] = useState(false);
  const [instruction, setInstruction] = useState('');

  if (!data) {
    return (
      <ResourceState
        loading={loading}
        error={error}
        forbidden={forbidden}
        onRetry={() => void refresh()}
      />
    );
  }

  const editable = canAct && data.editable;
  const title = data.kind === 'TRAINING' ? 'Protocolo de treino' : 'Protocolo alimentar';

  const save = async () => {
    if (!draft) return;
    const parsed = editProtocolRequestSchema.safeParse({
      kind: draft.kind,
      structure: draft.structure,
    });
    if (!parsed.success) {
      setIssues(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
      return;
    }
    setSaving(true);
    setIssues([]);
    try {
      if (amend) await amendActiveProtocol(amend.studentId, parsed.data);
      else await saveExceptionProtocol(caseId ?? '', parsed.data);
      setDraft(null);
      await Promise.all([refresh(), onChanged()]);
    } catch (err) {
      setIssues(
        err instanceof ProtocolEditError && err.issues.length > 0
          ? err.issues
          : [err instanceof Error ? err.message : 'Não foi possível salvar o protocolo.'],
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={card} aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-h3 font-semibold">
          {title} <span className="text-xs font-normal text-muted-foreground">v{data.version}</span>
        </h2>
        {editable && !draft ? (
          <Button type="button" variant="outline" onClick={() => setDraft(data)}>
            {amend ? 'Emendar protocolo' : 'Editar à mão'}
          </Button>
        ) : null}
      </div>
      {data.strategy ? (
        <p className="mt-1 text-xs text-muted-foreground">Estratégia: {data.strategy.title}</p>
      ) : null}

      <div className="mt-4">
        {draft ? (
          draft.kind === 'TRAINING' ? (
            <TrainingEditor
              structure={draft.structure}
              options={draft.exerciseOptions}
              onChange={(structure) => setDraft({ ...draft, structure })}
            />
          ) : (
            <NutritionEditor
              structure={draft.structure}
              foods={draft.foodOptions ?? []}
              onChange={(structure) => setDraft({ ...draft, structure })}
            />
          )
        ) : data.kind === 'TRAINING' ? (
          <TrainingView protocol={data} />
        ) : (
          <NutritionView structure={data.structure} />
        )}
      </div>

      {issues.length > 0 ? (
        <div role="alert" className="mt-4 rounded-lg border border-destructive p-3 text-xs">
          <p className="font-medium">O protocolo editado não passou na conferência:</p>
          <ul className="mt-1 list-disc pl-5">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {draft ? (
        <div className="mt-4 flex flex-wrap gap-3">
          <Button type="button" disabled={saving} onClick={() => void save()}>
            {saving ? 'Conferindo…' : 'Salvar edição'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => {
              setDraft(null);
              setIssues([]);
            }}
          >
            Descartar edição
          </Button>
        </div>
      ) : null}

      {amend && draft ? (
        <p className="mt-3 text-xs text-muted-foreground">
          Ao salvar, vira a próxima versão do protocolo do aluno (a agenda é mantida) e ele recebe o
          protocolo atualizado no WhatsApp.
        </p>
      ) : null}

      {editable && !draft && !amend ? (
        <div className="mt-6 border-t border-border pt-4">
          <h3 className="text-label font-semibold">Pedir ajuste aos agentes</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            O caso é encerrado e os agentes refazem só este protocolo com a sua orientação; o novo
            volta para a fila.
          </p>
          <TextField
            label="Orientação (ex.: trocar a corrida de sábado por bike, reduzir o volume de pernas)"
            value={instruction}
            rows={3}
            maxLength={1000}
            onChange={setInstruction}
          />
          <div className="mt-3">
            <ConfirmAction
              triggerLabel="Pedir ajuste"
              triggerVariant="outline"
              title="Pedir um novo protocolo aos agentes?"
              description="Este rascunho é descartado e o novo chega à fila para a sua revisão."
              confirmLabel="Pedir ajuste"
              confirmDisabled={instruction.trim().length < 3}
              onConfirm={async () => {
                await requestProtocolAdjustment(caseId ?? '', instruction.trim());
                setInstruction('');
                await onChanged();
              }}
            />
          </div>
        </div>
      ) : null}
    </section>
  );
}

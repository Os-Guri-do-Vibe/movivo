'use client';

/**
 * Plano alimentar na revisão: metas do dia (treino × descanso, mesma grade nas duas) e as
 * refeições com o cardápio em opções A/B/C — alimento, quantidade como o aluno mede e energia, em
 * colunas alinhadas. Orientações, suplementos e refeições livres ficam em painéis sob demanda.
 * Na edição: metas, parte da energia e proteína de cada refeição, orientação, e o cardápio
 * (alimento da base, quantidade, trocas). Nutrientes, totais e trocas o servidor recalcula.
 */
import {
  mealEnergyIssue,
  normalizeFoodName,
  type DailyTargets,
  type MealItem,
  type MealOption,
} from '@movivo/shared';
import type {
  NutritionPlanStructure,
  PlannedMeal,
  ProtocolReview as Protocol,
} from '@movivo/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useId, useMemo, useState, type KeyboardEvent } from 'react';

import { brl, OPTION_LETTERS, quantityLabel } from '@/lib/meal-menu';
import {
  capitalize,
  energyStrategyLabel,
  humanizeCode,
  mealLabel,
  percentLabel,
  targetCells,
} from '@/lib/protocol-format';
import { cn } from '@/lib/utils';

import { CONTROL_H, FIELD_SELECT, FOCUS_RING, ICON_BUTTON } from './control-center-table';
import { BulletList, Disclosure } from './detail-sections';
import { FieldLabel, NumField, RowIssues, TextInput } from './plan-fields';
import type { IssueMap } from './training-plan';

type NutritionProtocol = Extract<Protocol, { kind: 'NUTRITION' }>;
type FoodOption = NonNullable<NutritionProtocol['foodOptions']>[number];

const ITEM_COLS = 'grid-cols-[minmax(0,1fr)_5.5rem_5rem]';

/* -------------------------------------------------------------------------- */
/* Leitura                                                                    */
/* -------------------------------------------------------------------------- */

function TargetsCard({ title, targets }: { title: string; targets: DailyTargets }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4" aria-label={title}>
      <h4 className="text-label font-semibold">{title}</h4>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 @md:grid-cols-3">
        {targetCells(targets).map((cell) => (
          <div key={cell.label}>
            <dt className="text-xs text-muted-foreground">{cell.label}</dt>
            <dd className="text-label font-medium tabular-nums">{cell.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function OptionTabs({
  meal,
  active,
  onSelect,
}: {
  meal: PlannedMeal;
  active: number;
  onSelect: (index: number) => void;
}) {
  const options = meal.options ?? [];
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = (active + (event.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
    onSelect(next);
    event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [next]?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label={`Opções de ${mealLabel(meal.slot)}`}
      className="inline-flex rounded-lg border border-border p-0.5"
    >
      {options.map((option, index) => (
        <button
          key={`${index}-${option.title}`}
          type="button"
          role="tab"
          aria-selected={index === active}
          tabIndex={index === active ? 0 : -1}
          onKeyDown={onKeyDown}
          onClick={() => onSelect(index)}
          className={cn(
            FOCUS_RING,
            'min-h-9 min-w-11 rounded-md px-3 text-xs font-medium transition-colors',
            index === active
              ? 'bg-secondary text-secondary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Opção {OPTION_LETTERS[index] ?? index + 1}
        </button>
      ))}
    </div>
  );
}

function OptionTable({ option }: { option: MealOption }) {
  return (
    <div role="tabpanel" className="space-y-0">
      <p className="px-4 pt-3 text-label font-medium @xl:px-5">{option.title}</p>
      <div
        aria-hidden="true"
        className={cn(
          'grid gap-x-3 px-4 pt-2 pb-1 text-xs font-medium text-muted-foreground @xl:px-5',
          ITEM_COLS,
        )}
      >
        <span>Alimento</span>
        <span className="text-right">Quantidade</span>
        <span className="text-right">Caloria</span>
      </div>
      <ul className="divide-y divide-border">
        {option.items.map((item, index) => (
          <li key={`${item.foodId}-${index}`} className="px-4 py-2 @xl:px-5">
            <div className={cn('grid items-baseline gap-x-3', ITEM_COLS)}>
              <span className="min-w-0 text-label">{normalizeFoodName(item.name)}</span>
              <span className="text-right text-label font-medium tabular-nums">
                <span className="sr-only">Quantidade: </span>
                {quantityLabel(item)}
              </span>
              <span className="text-right text-xs text-muted-foreground tabular-nums">
                <span className="sr-only">Caloria: </span>
                {item.energyKcal} kcal
              </span>
            </div>
            {item.swaps.length > 0 ? (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Trocas:{' '}
                {item.swaps
                  .map((s) => `${quantityLabel(s)} de ${normalizeFoodName(s.name)}`)
                  .join(' · ')}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground tabular-nums @xl:px-5">
        Total {option.totals.energyKcal} kcal · proteína {Math.round(option.totals.proteinG)} g ·
        carboidrato {Math.round(option.totals.carbsG)} g · gordura {Math.round(option.totals.fatG)}{' '}
        g · ~{brl(option.estimatedCostBrl)}
      </p>
    </div>
  );
}

function MealView({ meal, compact = false }: { meal: PlannedMeal; compact?: boolean }) {
  const headingId = useId();
  const [active, setActive] = useState(0);
  const option = meal.options?.[active];
  const content =
    meal.options && meal.options.length > 0 && option ? (
      <>
        {meal.options.length > 1 ? (
          <div className="px-4 pt-3 @xl:px-5">
            <OptionTabs meal={meal} active={active} onSelect={setActive} />
          </div>
        ) : null}
        <OptionTable option={option} />
      </>
    ) : (
      <div className="px-4 py-3 @xl:px-5">
        <BulletList lines={meal.examples} />
      </div>
    );
  if (compact) return <div className="border-t border-border">{content}</div>;

  return (
    <article
      aria-labelledby={headingId}
      className="@container overflow-hidden rounded-xl border border-border bg-card"
    >
      <header className="grid gap-x-3 gap-y-1 px-4 pt-4 pb-3 @xl:grid-cols-[minmax(0,1fr)_auto] @xl:px-5">
        <h3 id={headingId} className="text-body font-semibold">
          {mealLabel(meal.slot)}
        </h3>
        <p className="text-xs text-muted-foreground tabular-nums @xl:pt-1 @xl:text-right">
          {percentLabel(meal.energyShare)} das calorias · {meal.proteinG} g de proteína
        </p>
        <p className="text-xs text-muted-foreground @xl:col-span-2">{meal.guidance}</p>
      </header>
      {content}
    </article>
  );
}

function NutritionExtras({ structure }: { structure: NutritionPlanStructure }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4">
      <Disclosure
        title="Orientações"
        summary={`${structure.guidelines.length} ${structure.guidelines.length === 1 ? 'orientação' : 'orientações'}`}
      >
        <BulletList lines={structure.guidelines} />
      </Disclosure>
      {structure.supplements.length > 0 ? (
        <Disclosure title="Suplementos" summary={`${structure.supplements.length} no plano`}>
          <BulletList lines={structure.supplements.map((s) => `${s.name}: ${s.guidance}`)} />
        </Disclosure>
      ) : null}
      {structure.freeMeals ? (
        <Disclosure title="Refeições livres" summary={`${structure.freeMeals.perWeek}× por semana`}>
          <p className="text-muted-foreground">{structure.freeMeals.guidance}</p>
          <ul className="mt-2 space-y-1.5">
            {structure.freeMeals.options.map((option) => (
              <li key={option.title}>
                <span className="font-medium">{option.title}</span> · ~{option.energyKcal} kcal.{' '}
                <span className="text-muted-foreground">
                  {option.description} {option.fitTip}
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </div>
  );
}

export function NutritionPlanView({
  structure,
  compact = false,
}: {
  structure: NutritionPlanStructure;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className="space-y-4">
        <Disclosure
          title="Metas do dia"
          summary={`${energyStrategyLabel(structure.strategy)} · treino ${structure.trainingDay.energyKcal.min}–${structure.trainingDay.energyKcal.max} kcal · descanso ${structure.restDay.energyKcal.min}–${structure.restDay.energyKcal.max} kcal`}
        >
          <div className="grid gap-3 @2xl:grid-cols-2">
            <TargetsCard title="Dia de treino" targets={structure.trainingDay} />
            <TargetsCard title="Dia de descanso" targets={structure.restDay} />
          </div>
        </Disclosure>
        <section aria-labelledby="refeicoes-do-plano" className="space-y-2">
          <h3 id="refeicoes-do-plano" className="text-label font-semibold">
            Refeições
          </h3>
          <ol className="space-y-1">
            {structure.meals.map((meal, index) => (
              <li key={`${meal.slot}-${index}`}>
                <Disclosure
                  title={mealLabel(meal.slot)}
                  summary={`${percentLabel(meal.energyShare)} das calorias · ${meal.proteinG} g de proteína · ${meal.guidance}`}
                  className="rounded-lg border border-border px-3 first:border-t"
                >
                  <MealView meal={meal} compact />
                </Disclosure>
              </li>
            ))}
          </ol>
        </section>
        <NutritionExtras structure={structure} />
        <section className="rounded-lg bg-secondary/60 px-4 py-3">
          <h3 className="text-xs font-medium text-muted-foreground">Observações do protocolo</h3>
          <p className="mt-1 whitespace-pre-line text-label">{structure.summary}</p>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <p className="max-w-prose text-label text-muted-foreground">{structure.summary}</p>
      <section aria-labelledby="metas-do-dia" className="@container space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="metas-do-dia" className="text-label font-semibold">
            Metas do dia
          </h3>
          <p className="text-xs text-muted-foreground">
            {energyStrategyLabel(structure.strategy)}
            {structure.estimatedDailyCostBrl
              ? ` · ~${brl(structure.estimatedDailyCostBrl)} por dia`
              : ''}
          </p>
        </div>
        <div className="grid gap-3 @2xl:grid-cols-2">
          <TargetsCard title="Dia de treino" targets={structure.trainingDay} />
          <TargetsCard title="Dia de descanso" targets={structure.restDay} />
        </div>
      </section>
      <section aria-labelledby="refeicoes-do-plano" className="space-y-3">
        <h3 id="refeicoes-do-plano" className="text-label font-semibold">
          Refeições
        </h3>
        <ol className="space-y-3">
          {structure.meals.map((meal, index) => (
            <li key={`${meal.slot}-${index}`}>
              <MealView meal={meal} />
            </li>
          ))}
        </ol>
      </section>
      <NutritionExtras structure={structure} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Edição                                                                     */
/* -------------------------------------------------------------------------- */

const ICON = cn(
  FOCUS_RING,
  ICON_BUTTON,
  'inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-30',
);

const lines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

function TargetsEditor({
  title,
  targets,
  issues,
  onChange,
}: {
  title: string;
  targets: DailyTargets;
  issues: readonly string[] | undefined;
  onChange: (targets: DailyTargets) => void;
}) {
  const set =
    (key: Exclude<keyof DailyTargets, 'energyKcal'>, fallback: number) =>
    (value: number | undefined) =>
      onChange({ ...targets, [key]: value ?? fallback });
  const ofDay = title.toLocaleLowerCase('pt-BR');
  return (
    <fieldset
      className={cn('rounded-xl border bg-card p-4', issues ? 'border-coral' : 'border-border')}
    >
      <legend className="px-1 text-label font-semibold">{title}</legend>
      <div className="grid grid-cols-2 gap-2 @md:grid-cols-4">
        <NumField
          label="Caloria mín. (kcal)"
          ariaLabel={`Caloria mínima no ${ofDay}`}
          value={targets.energyKcal.min}
          min={800}
          max={6000}
          step={10}
          onChange={(min) =>
            onChange({ ...targets, energyKcal: { ...targets.energyKcal, min: min ?? 800 } })
          }
        />
        <NumField
          label="Caloria máx. (kcal)"
          ariaLabel={`Caloria máxima no ${ofDay}`}
          value={targets.energyKcal.max}
          min={800}
          max={6000}
          step={10}
          onChange={(max) =>
            onChange({ ...targets, energyKcal: { ...targets.energyKcal, max: max ?? 800 } })
          }
        />
        <NumField
          label="Proteína (g)"
          ariaLabel={`Proteína no ${ofDay}`}
          value={targets.proteinG}
          min={30}
          max={400}
          onChange={set('proteinG', 30)}
        />
        <NumField
          label="Carboidrato (g)"
          ariaLabel={`Carboidrato no ${ofDay}`}
          value={targets.carbsG}
          min={20}
          max={1000}
          onChange={set('carbsG', 20)}
        />
        <NumField
          label="Gordura (g)"
          ariaLabel={`Gordura no ${ofDay}`}
          value={targets.fatG}
          min={20}
          max={300}
          onChange={set('fatG', 20)}
        />
        <NumField
          label="Fibras (g)"
          ariaLabel={`Fibras no ${ofDay}`}
          value={targets.fiberG}
          min={10}
          max={80}
          onChange={set('fiberG', 10)}
        />
        <NumField
          label="Água (ml)"
          ariaLabel={`Água no ${ofDay}`}
          value={targets.waterMl}
          min={1000}
          max={8000}
          step={100}
          onChange={set('waterMl', 1000)}
        />
      </div>
      {issues ? (
        <div className="mt-2">
          <RowIssues messages={issues} />
        </div>
      ) : null}
    </fieldset>
  );
}

function FoodSelect({
  label,
  value,
  name,
  foods,
  onChange,
}: {
  label: string;
  value: string;
  name: string;
  foods: readonly FoodOption[];
  onChange: (food: FoodOption) => void;
}) {
  const id = useId();
  const groups = useMemo(() => {
    const byCategory = new Map<string, FoodOption[]>();
    for (const food of foods) {
      const list = byCategory.get(food.category) ?? [];
      list.push(food);
      byCategory.set(food.category, list);
    }
    return [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR'));
  }, [foods]);
  const known = foods.some((food) => food.id === value);
  return (
    <FieldLabel label="Alimento" htmlFor={id}>
      <select
        id={id}
        aria-label={label}
        value={value}
        onChange={(event) => {
          const food = foods.find((f) => f.id === event.target.value);
          if (food) onChange(food);
        }}
        className={cn(FIELD_SELECT, CONTROL_H, FOCUS_RING, 'bg-background')}
      >
        {known ? null : <option value={value}>{name}</option>}
        {groups.map(([category, list]) => (
          <optgroup key={category} label={capitalize(humanizeCode(category))}>
            {list.map((food) => (
              <option key={food.id} value={food.id}>
                {normalizeFoodName(food.name)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </FieldLabel>
  );
}

function blankItem(food: FoodOption): MealItem {
  return {
    foodId: food.id,
    name: normalizeFoodName(food.name),
    grams: 100,
    energyKcal: Math.round(food.energyKcal),
    proteinG: food.proteinG,
    carbsG: food.carbsG,
    fatG: food.fatG,
    swaps: [],
  };
}

function OptionEditor({
  mealName,
  index,
  option,
  foods,
  onChange,
}: {
  mealName: string;
  index: number;
  option: MealOption;
  foods: readonly FoodOption[];
  onChange: (option: MealOption) => void;
}) {
  const letter = OPTION_LETTERS[index] ?? String(index + 1);
  const setItem = (itemIndex: number, next: MealItem) =>
    onChange({ ...option, items: option.items.map((it, i) => (i === itemIndex ? next : it)) });
  const first = foods[0];
  return (
    <section
      aria-label={`${mealName}, opção ${letter}`}
      className="@container space-y-3 rounded-lg border border-border bg-background p-3"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-2">
        <TextInput
          label={`Opção ${letter}`}
          ariaLabel={`Título da opção ${letter} de ${mealName}`}
          value={option.title}
          maxLength={80}
          onChange={(title) => onChange({ ...option, title })}
        />
        <NumField
          label="Custo (R$)"
          ariaLabel={`Custo estimado da opção ${letter} de ${mealName}`}
          value={option.estimatedCostBrl}
          min={0}
          max={300}
          step={0.5}
          onChange={(cost) => onChange({ ...option, estimatedCostBrl: cost ?? 0 })}
        />
      </div>
      <ol className="space-y-2" aria-label={`Alimentos da opção ${letter}`}>
        {option.items.map((item, itemIndex) => (
          <li
            key={`${item.foodId}-${itemIndex}`}
            className="space-y-2 rounded-md bg-secondary/40 p-2"
          >
            <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_auto] items-end gap-2">
              <FoodSelect
                label={`Alimento ${itemIndex + 1} da opção ${letter}`}
                value={item.foodId}
                name={normalizeFoodName(item.name)}
                foods={foods}
                onChange={(food) =>
                  setItem(itemIndex, {
                    ...item,
                    foodId: food.id,
                    name: normalizeFoodName(food.name),
                    swaps: [],
                  })
                }
              />
              <NumField
                label="Gramas"
                ariaLabel={`Quantidade em gramas de ${normalizeFoodName(item.name)}`}
                value={item.grams}
                min={1}
                max={1500}
                onChange={(grams) => setItem(itemIndex, { ...item, grams: grams ?? 1 })}
              />
              <button
                type="button"
                aria-label={`Remover ${normalizeFoodName(item.name)}`}
                disabled={option.items.length <= 1}
                onClick={() =>
                  onChange({ ...option, items: option.items.filter((_, i) => i !== itemIndex) })
                }
                className={ICON}
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </button>
            </div>
            {item.swaps.map((swap, swapIndex) => (
              <div
                key={`${swap.foodId}-${swapIndex}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 pl-3"
              >
                <FoodSelect
                  label={`Troca ${swapIndex + 1} de ${normalizeFoodName(item.name)}`}
                  value={swap.foodId}
                  name={normalizeFoodName(swap.name)}
                  foods={foods}
                  onChange={(food) =>
                    setItem(itemIndex, {
                      ...item,
                      swaps: item.swaps.map((sw, i) =>
                        i === swapIndex
                          ? { ...sw, foodId: food.id, name: normalizeFoodName(food.name) }
                          : sw,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  aria-label={`Remover a troca ${normalizeFoodName(swap.name)}`}
                  onClick={() =>
                    setItem(itemIndex, {
                      ...item,
                      swaps: item.swaps.filter((_, i) => i !== swapIndex),
                    })
                  }
                  className={ICON}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </button>
              </div>
            ))}
            {item.swaps.length < 3 && first ? (
              <button
                type="button"
                onClick={() =>
                  setItem(itemIndex, {
                    ...item,
                    swaps: [
                      ...item.swaps,
                      {
                        foodId: first.id,
                        name: normalizeFoodName(first.name),
                        grams: 100,
                        energyKcal: 0,
                      },
                    ],
                  })
                }
                className={cn(
                  FOCUS_RING,
                  'inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground hover:text-foreground lg:min-h-9',
                )}
              >
                <Plus aria-hidden="true" className="size-3.5" />
                Troca equivalente (quantidade calculada ao salvar)
              </button>
            ) : null}
          </li>
        ))}
      </ol>
      {option.items.length < 8 && first ? (
        <button
          type="button"
          onClick={() => onChange({ ...option, items: [...option.items, blankItem(first)] })}
          className={cn(
            FOCUS_RING,
            'flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-input text-label font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground lg:min-h-10',
          )}
        >
          <Plus aria-hidden="true" className="size-4" />
          Adicionar alimento
        </button>
      ) : null}
    </section>
  );
}

export function NutritionPlanEditor({
  structure,
  foods,
  issues,
  onChange,
}: {
  structure: NutritionPlanStructure;
  foods: readonly FoodOption[];
  issues: IssueMap;
  onChange: (structure: NutritionPlanStructure, structural?: boolean) => void;
}) {
  const energyTotal = structure.meals.reduce((sum, meal) => sum + meal.energyShare, 0);
  const energyOff = mealEnergyIssue(structure);
  return (
    <div className="@container space-y-4">
      <RowIssues messages={issues.get('plan')} />
      <div className="grid gap-3 @4xl:grid-cols-2">
        <TargetsEditor
          title="Dia de treino"
          targets={structure.trainingDay}
          issues={issues.get('targets:trainingDay')}
          onChange={(trainingDay) => onChange({ ...structure, trainingDay })}
        />
        <TargetsEditor
          title="Dia de descanso"
          targets={structure.restDay}
          issues={issues.get('targets:restDay')}
          onChange={(restDay) => onChange({ ...structure, restDay })}
        />
      </div>
      <p
        className={cn(
          'flex items-center gap-2 text-xs tabular-nums',
          energyOff ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {energyOff ? <span aria-hidden="true" className="size-1.5 rounded-full bg-coral" /> : null}
        Soma das calorias das refeições: {percentLabel(energyTotal)}
        {energyOff ? ' (precisa fechar em 100%)' : ''}
      </p>
      <ol className="space-y-3" aria-label="Refeições do plano">
        {structure.meals.map((meal, mealIndex) => {
          const name = mealLabel(meal.slot);
          const mealIssues = issues.get(`meal:${mealIndex}`);
          const setMeal = (next: PlannedMeal) =>
            onChange({
              ...structure,
              meals: structure.meals.map((m, i) => (i === mealIndex ? next : m)),
            });
          return (
            <li key={`${meal.slot}-${mealIndex}`}>
              <fieldset
                className={cn(
                  '@container space-y-3 rounded-xl border bg-card p-4',
                  mealIssues ? 'border-coral' : 'border-border',
                )}
              >
                <legend className="px-1 text-body font-semibold">{name}</legend>
                <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-[8rem_8rem_minmax(0,1fr)]">
                  <NumField
                    label="Caloria do dia (%)"
                    ariaLabel={`Parte das calorias do dia em ${name} (%)`}
                    value={Math.round(meal.energyShare * 100)}
                    min={0}
                    max={100}
                    onChange={(pct) => setMeal({ ...meal, energyShare: (pct ?? 0) / 100 })}
                  />
                  <NumField
                    label="Proteína (g)"
                    ariaLabel={`Proteína em ${name}`}
                    value={meal.proteinG}
                    min={0}
                    max={150}
                    onChange={(proteinG) => setMeal({ ...meal, proteinG: proteinG ?? 0 })}
                  />
                  <TextInput
                    className="col-span-2 @2xl:col-span-1"
                    label="Orientação"
                    ariaLabel={`Orientação de ${name}`}
                    value={meal.guidance}
                    maxLength={300}
                    onChange={(guidance) => setMeal({ ...meal, guidance })}
                  />
                </div>
                {meal.options ? (
                  <div className="grid gap-3 @4xl:grid-cols-2">
                    {meal.options.map((option, optionIndex) => (
                      <OptionEditor
                        key={optionIndex}
                        mealName={name}
                        index={optionIndex}
                        option={option}
                        foods={foods}
                        onChange={(next) =>
                          setMeal({
                            ...meal,
                            options: meal.options?.map((o, i) => (i === optionIndex ? next : o)),
                          })
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <TextInput
                    multiline
                    label="Exemplos (um por linha, até 5)"
                    ariaLabel={`Exemplos de ${name}`}
                    value={meal.examples.join('\n')}
                    maxLength={1100}
                    onChange={(text) => setMeal({ ...meal, examples: lines(text) })}
                  />
                )}
                <RowIssues messages={mealIssues} />
              </fieldset>
            </li>
          );
        })}
      </ol>
      <TextInput
        multiline
        label="Orientações (uma por linha, até 10)"
        ariaLabel="Orientações do plano alimentar"
        value={structure.guidelines.join('\n')}
        maxLength={3100}
        onChange={(text) => onChange({ ...structure, guidelines: lines(text) })}
      />
      <p className="text-xs text-muted-foreground">
        Nutrientes, totais e a quantidade das trocas são recalculados pelo servidor ao salvar.
      </p>
    </div>
  );
}

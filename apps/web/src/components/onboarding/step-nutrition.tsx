'use client';

import { MEAL_SLOT_LABELS, type MealSlot } from '@movivo/shared';

import {
  ChoiceGroup,
  Combobox,
  CurrencyInput,
  FieldLabel,
  FieldValidation,
  QuestionField,
  TextArea,
  TextInput,
  UnitInput,
  YesNo,
} from './fields';
import {
  foodBudgetError,
  mealsOutsideError,
  mealsPerDayError,
  nutritionComplete,
  type AllergyDraft,
  type DietaryRestriction,
  type NutritionDraft,
  type Supplement,
} from './onboarding-drafts';
import { Labeled, StepFrame } from './step-frame';

const MEAL_ITEMS = (Object.keys(MEAL_SLOT_LABELS) as MealSlot[]).map((value) => ({
  value,
  label: MEAL_SLOT_LABELS[value],
}));

const RESTRICTION_ITEMS: { value: DietaryRestriction; label: string }[] = [
  { value: 'VEGETARIAN', label: 'Vegetariano' },
  { value: 'VEGAN', label: 'Vegano' },
  { value: 'LACTOSE_FREE', label: 'Sem lactose' },
  { value: 'GLUTEN_FREE', label: 'Sem glúten' },
  { value: 'HALAL', label: 'Halal' },
  { value: 'KOSHER', label: 'Kosher' },
];

const SUPPLEMENT_ITEMS: { value: Supplement; label: string }[] = [
  { value: 'CREATINE', label: 'Creatina' },
  { value: 'WHEY', label: 'Proteína' },
  { value: 'CAFFEINE', label: 'Cafeína' },
  { value: 'VITAMIN_D', label: 'Vitamina D' },
  { value: 'OMEGA_3', label: 'Ômega 3' },
  { value: 'MULTIVITAMIN', label: 'Multivitamínico' },
  { value: 'OTHER', label: 'Outro' },
];

const HUNGER_ITEMS: { value: NonNullable<NutritionDraft['hunger']>; label: string }[] = [
  { value: 'LOW', label: 'Pouca fome' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'HIGH', label: 'Muita fome' },
  { value: 'VARIES', label: 'Varia bastante' },
];

const SEVERITY_ITEMS: { value: NonNullable<AllergyDraft['severity']>; label: string }[] = [
  { value: 'INTOLERANCE', label: 'Intolerância' },
  { value: 'ALLERGY', label: 'Alergia' },
  { value: 'SEVERE_ALLERGY', label: 'Alergia grave' },
];

const COOKING_ITEMS: { value: NonNullable<NutritionDraft['cookingCapacity']>; label: string }[] = [
  { value: 'NONE', label: 'Não cozinho' },
  { value: 'BASIC', label: 'Cozinho o básico' },
  { value: 'GOOD', label: 'Cozinho bem' },
];

const MAX_ALLERGIES = 10;

export function StepNutrition({
  data,
  onChange,
  onContinue,
  onBack,
  saving,
  resumed,
}: {
  data: NutritionDraft;
  onChange: (data: NutritionDraft) => void;
  onContinue: () => void;
  onBack?: () => void;
  saving: boolean;
  resumed: boolean;
}) {
  const toggle = <T extends string>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  const setAllergy = (index: number, next: AllergyDraft) =>
    onChange({ ...data, allergies: data.allergies.map((a, i) => (i === index ? next : a)) });

  return (
    <StepFrame
      title="Como é a sua alimentação?"
      description="A MOVIVO acompanha treino e alimentação juntos. Aqui a gente só aprende a sua rotina, nada de dieta pronta."
      notice={
        resumed
          ? 'Alergias e textos livres ficam guardados em sigilo e não aparecem de novo. Responda outra vez sobre alergias (e qual é o outro suplemento, se houver). O que você gosta ou não come fica como estava se ficar em branco.'
          : undefined
      }
      canContinue={nutritionComplete(data)}
      saving={saving}
      onContinue={onContinue}
      onBack={onBack}
    >
      <ChoiceGroup
        legend="Você sabe cozinhar?"
        items={COOKING_ITEMS}
        selected={data.cookingCapacity ? [data.cookingCapacity] : []}
        onToggle={(cookingCapacity) => onChange({ ...data, cookingCapacity })}
        layout="stack"
      />
      <Labeled id="meals-out" label="Quantas refeições por semana você faz fora de casa?">
        <FieldValidation error={mealsOutsideError(data.mealsOutsideHomePerWeek)}>
          <UnitInput
            id="meals-out"
            unit={(meals) => (meals === '1' ? 'refeição' : 'refeições')}
            maxInteger={2}
            placeholder="0"
            value={data.mealsOutsideHomePerWeek}
            onChange={(mealsOutsideHomePerWeek) => onChange({ ...data, mealsOutsideHomePerWeek })}
          />
        </FieldValidation>
      </Labeled>
      <Labeled id="food-budget" label="Qual seu orçamento mensal para alimentação?">
        <FieldValidation error={foodBudgetError(data.foodBudgetCents)}>
          <CurrencyInput
            id="food-budget"
            value={data.foodBudgetCents}
            onChange={(foodBudgetCents) => onChange({ ...data, foodBudgetCents })}
          />
        </FieldValidation>
      </Labeled>
      <Labeled id="meals-per-day" label="Quantas refeições você faz por dia?">
        <FieldValidation error={mealsPerDayError(data.mealsPerDay)}>
          <UnitInput
            id="meals-per-day"
            unit={(meals) => (meals === '1' ? 'refeição' : 'refeições')}
            maxInteger={1}
            placeholder="0"
            value={data.mealsPerDay}
            onChange={(mealsPerDay) => onChange({ ...data, mealsPerDay })}
          />
        </FieldValidation>
      </Labeled>
      <ChoiceGroup
        legend="Quais refeições você costuma fazer?"
        items={MEAL_ITEMS}
        selected={data.usualMeals}
        multi
        layout="stack"
        onToggle={(meal) => onChange({ ...data, usualMeals: toggle(data.usualMeals, meal) })}
      />
      <Combobox
        id="dietary-restrictions"
        legend="Alguma restrição alimentar?"
        items={RESTRICTION_ITEMS}
        multiple
        value={data.dietaryRestrictions}
        onChange={(r) =>
          onChange({ ...data, dietaryRestrictions: toggle(data.dietaryRestrictions, r) })
        }
        placeholder="Nenhuma restrição"
        optional
      />
      <YesNo
        legend="Você tem alguma alergia ou intolerância alimentar?"
        value={data.hasAllergy}
        onChange={(yes) =>
          onChange({
            ...data,
            hasAllergy: yes,
            allergies: yes
              ? data.allergies.length > 0
                ? data.allergies
                : [{ allergen: '', severity: null }]
              : [],
          })
        }
      />
      {data.hasAllergy &&
        data.allergies.map((allergy, index) => (
          <div key={index} className="flex flex-col gap-6 rounded-xl border border-border p-4">
            <QuestionField>
              <FieldLabel htmlFor={`allergen-${index}`}>Alimento ou substância</FieldLabel>
              <FieldValidation
                error={
                  allergy.allergen.trim() === '' ? 'Informe o alimento ou a substância.' : undefined
                }
              >
                <TextInput
                  id={`allergen-${index}`}
                  value={allergy.allergen}
                  onChange={(allergen) => setAllergy(index, { ...allergy, allergen })}
                  maxLength={60}
                />
              </FieldValidation>
            </QuestionField>
            <Combobox
              id={`severity-${index}`}
              legend="Gravidade"
              items={SEVERITY_ITEMS}
              value={allergy.severity}
              onChange={(severity) => setAllergy(index, { ...allergy, severity })}
              placeholder="Selecione a gravidade"
            />
            <button
              type="button"
              className="self-start text-label font-semibold underline underline-offset-4"
              onClick={() => {
                const allergies = data.allergies.filter((_, i) => i !== index);
                onChange({ ...data, allergies, hasAllergy: allergies.length > 0 });
              }}
            >
              Remover
            </button>
          </div>
        ))}
      {data.hasAllergy && data.allergies.length < MAX_ALLERGIES && (
        <button
          type="button"
          className="self-start text-label font-semibold underline underline-offset-4"
          onClick={() =>
            onChange({ ...data, allergies: [...data.allergies, { allergen: '', severity: null }] })
          }
        >
          Adicionar outra
        </button>
      )}
      <ChoiceGroup
        legend="Você usa algum suplemento?"
        items={SUPPLEMENT_ITEMS}
        selected={data.supplements}
        multi
        optional
        layout="stack"
        onToggle={(s) => onChange({ ...data, supplements: toggle(data.supplements, s) })}
      />
      {data.supplements.includes('OTHER') && (
        <div className="border-l-2 border-primary pl-4">
          <Labeled id="supplement-other" label="Qual outro suplemento você usa?">
            <FieldValidation
              error={
                data.supplementOther.trim() === '' ? 'Informe qual é o suplemento.' : undefined
              }
            >
              <TextInput
                id="supplement-other"
                value={data.supplementOther}
                onChange={(supplementOther) => onChange({ ...data, supplementOther })}
                maxLength={80}
              />
            </FieldValidation>
          </Labeled>
        </div>
      )}
      <ChoiceGroup
        legend="Como costuma ser a sua fome ao longo do dia?"
        items={HUNGER_ITEMS}
        selected={data.hunger ? [data.hunger] : []}
        onToggle={(hunger) => onChange({ ...data, hunger })}
      />
      <Labeled id="liked-foods" label="O que você gosta de comer?" optional>
        <TextArea
          id="liked-foods"
          value={data.likedFoods}
          onChange={(likedFoods) => onChange({ ...data, likedFoods })}
          maxLength={300}
        />
      </Labeled>
      <Labeled id="disliked-foods" label="O que você não come de jeito nenhum?" optional>
        <TextArea
          id="disliked-foods"
          value={data.dislikedFoods}
          onChange={(dislikedFoods) => onChange({ ...data, dislikedFoods })}
          maxLength={300}
        />
      </Labeled>
    </StepFrame>
  );
}

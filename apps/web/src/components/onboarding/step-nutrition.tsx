'use client';

import { MEAL_SLOT_LABELS, type MealSlot } from '@movivo/shared';

import { ChoiceGroup, TextArea, TextInput, YesNo } from './fields';
import {
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
  { value: 'WHEY', label: 'Whey / proteína em pó' },
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

const SEVERITY_ITEMS: { value: AllergyDraft['severity']; label: string }[] = [
  { value: 'INTOLERANCE', label: 'Intolerância' },
  { value: 'ALLERGY', label: 'Alergia' },
  { value: 'SEVERE_ALLERGY', label: 'Alergia grave' },
];

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
      description="A MOVIVO acompanha treino e alimentação juntos. Aqui a gente só aprende a sua rotina — nada de dieta pronta."
      notice={
        resumed
          ? 'Alergias e textos livres ficam guardados em sigilo e não são exibidos de novo. Se voltar aqui, responda outra vez para atualizar.'
          : undefined
      }
      canContinue={nutritionComplete(data)}
      saving={saving}
      onContinue={onContinue}
      onBack={onBack}
    >
      <Labeled id="meals-per-day" label="Quantas refeições você faz por dia?">
        <TextInput
          id="meals-per-day"
          inputMode="numeric"
          value={data.mealsPerDay}
          onChange={(mealsPerDay) => onChange({ ...data, mealsPerDay })}
        />
      </Labeled>
      <ChoiceGroup
        legend="Quais refeições você costuma fazer?"
        items={MEAL_ITEMS}
        selected={data.usualMeals}
        multi
        columns
        onToggle={(meal) => onChange({ ...data, usualMeals: toggle(data.usualMeals, meal) })}
      />
      <ChoiceGroup
        legend="Alguma restrição alimentar? (opcional)"
        items={RESTRICTION_ITEMS}
        selected={data.dietaryRestrictions}
        multi
        columns
        onToggle={(r) =>
          onChange({ ...data, dietaryRestrictions: toggle(data.dietaryRestrictions, r) })
        }
      />
      <YesNo
        legend="Você tem alguma alergia ou intolerância alimentar?"
        value={data.allergies.length > 0}
        onChange={(yes) =>
          onChange({
            ...data,
            allergies: yes ? [{ allergen: '', severity: 'ALLERGY' }] : [],
          })
        }
      />
      {data.allergies.map((allergy, index) => (
        <div key={index} className="flex flex-col gap-3 rounded-xl border border-border p-4">
          <Labeled id={`allergen-${index}`} label="Alimento ou substância">
            <TextInput
              id={`allergen-${index}`}
              value={allergy.allergen}
              onChange={(allergen) => setAllergy(index, { ...allergy, allergen })}
              maxLength={60}
            />
          </Labeled>
          <ChoiceGroup
            legend="Gravidade"
            items={SEVERITY_ITEMS}
            selected={[allergy.severity]}
            onToggle={(severity) => setAllergy(index, { ...allergy, severity })}
          />
          <button
            type="button"
            className="self-start text-label font-semibold underline underline-offset-4"
            onClick={() =>
              onChange({ ...data, allergies: data.allergies.filter((_, i) => i !== index) })
            }
          >
            Remover
          </button>
        </div>
      ))}
      {data.allergies.length > 0 && data.allergies.length < 10 && (
        <button
          type="button"
          className="self-start text-label font-semibold underline underline-offset-4"
          onClick={() =>
            onChange({
              ...data,
              allergies: [...data.allergies, { allergen: '', severity: 'ALLERGY' }],
            })
          }
        >
          Adicionar outra
        </button>
      )}
      <ChoiceGroup
        legend="Você usa algum suplemento? (opcional)"
        items={SUPPLEMENT_ITEMS}
        selected={data.supplements}
        multi
        columns
        onToggle={(s) => onChange({ ...data, supplements: toggle(data.supplements, s) })}
      />
      <ChoiceGroup
        legend="Como costuma ser a sua fome ao longo do dia?"
        items={HUNGER_ITEMS}
        selected={data.hunger ? [data.hunger] : []}
        onToggle={(hunger) => onChange({ ...data, hunger })}
        columns
      />
      <Labeled id="liked-foods" label="O que você gosta de comer?" help="Opcional.">
        <TextArea
          id="liked-foods"
          value={data.likedFoods}
          onChange={(likedFoods) => onChange({ ...data, likedFoods })}
          maxLength={300}
        />
      </Labeled>
      <Labeled id="disliked-foods" label="O que você não come de jeito nenhum?" help="Opcional.">
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

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
  { value: 'WHEY', label: 'Whey ou outra proteína em pó' },
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

const SEVERITY_ITEMS: {
  value: NonNullable<AllergyDraft['severity']>;
  label: string;
  description: string;
}[] = [
  {
    value: 'INTOLERANCE',
    label: 'Intolerância',
    description: 'Desconforto na digestão, como gases, inchaço ou diarreia.',
  },
  {
    value: 'ALLERGY',
    label: 'Alergia',
    description: 'Reação no corpo, como coceira, manchas na pele ou inchaço leve.',
  },
  {
    value: 'SEVERE_ALLERGY',
    label: 'Alergia grave',
    description: 'Reação forte, como falta de ar ou inchaço na boca ou na garganta.',
  },
];

const COOKING_ITEMS: {
  value: NonNullable<NutritionDraft['cookingCapacity']>;
  label: string;
  description: string;
}[] = [
  {
    value: 'NONE',
    label: 'Não cozinho',
    description: 'Como fora, peço comida ou alguém cozinha para mim.',
  },
  {
    value: 'BASIC',
    label: 'Cozinho o básico',
    description: 'Arroz, ovo, carne grelhada, coisas simples.',
  },
  { value: 'GOOD', label: 'Cozinho bem', description: 'Faço receitas variadas sem dificuldade.' },
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
      description="Seu plano alimentar parte da sua rotina de hoje: o que você come, quanto pode gastar e quanto cozinha. Nada de dieta pronta."
      notice={
        resumed
          ? 'Por sigilo, alergias e textos livres não aparecem de novo. Responda outra vez a pergunta de alergias (e o nome do outro suplemento, se houver). O que você gosta ou não come continua salvo se ficar em branco.'
          : undefined
      }
      canContinue={nutritionComplete(data)}
      saving={saving}
      onContinue={onContinue}
      onBack={onBack}
    >
      <ChoiceGroup
        legend="Como você se vira na cozinha?"
        help="Ajuda a escolher refeições que cabem na sua rotina e a explicar o preparo no seu nível."
        items={COOKING_ITEMS}
        selected={data.cookingCapacity ? [data.cookingCapacity] : []}
        onToggle={(cookingCapacity) => onChange({ ...data, cookingCapacity })}
        layout="stack"
      />
      <Labeled
        id="meals-out"
        label="Quantas refeições por semana você faz fora de casa?"
        help="Conte restaurante, delivery e marmita comprada. Ex.: almoço fora de segunda a sexta = 5."
      >
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
      <Labeled
        id="food-budget"
        label="Quanto você pode gastar por mês com a sua alimentação?"
        help="Só com você, somando mercado e comida fora. Uma estimativa já ajuda."
      >
        <FieldValidation error={foodBudgetError(data.foodBudgetCents)}>
          <CurrencyInput
            id="food-budget"
            value={data.foodBudgetCents}
            onChange={(foodBudgetCents) => onChange({ ...data, foodBudgetCents })}
          />
        </FieldValidation>
      </Labeled>
      <ChoiceGroup
        legend="Quais refeições você faz num dia comum?"
        help={
          data.usualMeals.length === 0
            ? 'Marque todas, lanches incluídos. O plano é montado em cima delas.'
            : `Marque todas, lanches incluídos. O plano é montado em cima delas. ${data.usualMeals.length} ${data.usualMeals.length === 1 ? 'refeição marcada' : 'refeições marcadas'}.`
        }
        items={MEAL_ITEMS}
        selected={data.usualMeals}
        multi
        layout="stack"
        onToggle={(meal) => onChange({ ...data, usualMeals: toggle(data.usualMeals, meal) })}
      />
      <Combobox
        id="dietary-restrictions"
        legend="Você segue algum estilo de alimentação ou restrição?"
        help="Por escolha, religião ou saúde. Alergias e intolerâncias têm uma pergunta própria logo abaixo."
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
              <FieldLabel htmlFor={`allergen-${index}`}>Qual alimento ou substância?</FieldLabel>
              <FieldValidation
                error={
                  allergy.allergen.trim() === '' ? 'Escreva o alimento ou a substância.' : undefined
                }
              >
                <TextInput
                  id={`allergen-${index}`}
                  value={allergy.allergen}
                  onChange={(allergen) => setAllergy(index, { ...allergy, allergen })}
                  placeholder="Ex.: amendoim, camarão, lactose"
                  maxLength={60}
                />
              </FieldValidation>
            </QuestionField>
            <Combobox
              id={`severity-${index}`}
              legend="Que tipo de reação você tem?"
              items={SEVERITY_ITEMS}
              value={allergy.severity}
              onChange={(severity) => setAllergy(index, { ...allergy, severity })}
              placeholder="Selecione o tipo de reação"
            />
            <button
              type="button"
              className="self-start text-label font-semibold underline underline-offset-4"
              onClick={() => {
                const allergies = data.allergies.filter((_, i) => i !== index);
                onChange({ ...data, allergies, hasAllergy: allergies.length > 0 });
              }}
            >
              Remover este item
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
          Adicionar outra alergia ou intolerância
        </button>
      )}
      <ChoiceGroup
        legend="Você usa algum suplemento hoje?"
        help="Se não usa nenhum, pode pular."
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
      <Labeled
        id="liked-foods"
        label="O que você gosta de comer?"
        help="Comidas que você quer ver no plano. Ex.: frango, cuscuz, açaí."
        optional
      >
        <TextArea
          id="liked-foods"
          value={data.likedFoods}
          onChange={(likedFoods) => onChange({ ...data, likedFoods })}
          maxLength={300}
        />
      </Labeled>
      <Labeled
        id="disliked-foods"
        label="O que você não come de jeito nenhum?"
        help="Por gosto. Ex.: fígado, coentro. Alergias já foram informadas acima."
        optional
      >
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

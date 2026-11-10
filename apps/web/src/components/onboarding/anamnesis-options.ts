/**
 * Opções de resposta da anamnese, com o texto exato que o aluno lê no formulário. Fonte única:
 * as etapas do formulário montam as escolhas daqui, e o painel da equipe traduz as respostas
 * gravadas (códigos) com as mesmas listas (`lib/anamnesis-labels.ts`). Só dados, sem JSX, para
 * o painel não carregar os componentes do formulário.
 *
 * Os rótulos que já vivem no `@movivo/shared` (objetivos, regiões, refeições, esportes,
 * medidas, PAR-Q) continuam lá; aqui fica o que só o formulário define.
 */
import type {
  BiologicalSex,
  CoachedModality,
  DaySlot,
  DeclaredGoal,
  ExperienceLevel,
  OnboardingNutritionStep,
  OnboardingPreferencesStep,
  PainTrend,
  TargetEvent,
  TrainingVenue,
} from '@movivo/shared';

export interface OptionItem<T extends string> {
  value: T;
  label: string;
  description?: string;
}

/** Opção com descrição obrigatória (escolhas em pilha, que explicam cada alternativa). */
export interface DescribedOption<T extends string> extends OptionItem<T> {
  description: string;
}

// --- 1. Cadastro ----------------------------------------------------------------------------

export const BIOLOGICAL_SEX_ITEMS: OptionItem<BiologicalSex>[] = [
  { value: 'FEMALE', label: 'Feminino' },
  { value: 'MALE', label: 'Masculino' },
];

// --- 2. Objetivos ---------------------------------------------------------------------------

export const EMPHASIS_ITEMS: DescribedOption<DeclaredGoal['emphasis']>[] = [
  {
    value: 'AESTHETICS',
    label: 'Estética e composição corporal',
    description: 'Como o corpo fica: mais músculo, menos gordura.',
  },
  {
    value: 'PERFORMANCE',
    label: 'Desempenho',
    description: 'O que o corpo faz: mais força, velocidade ou resistência.',
  },
  {
    value: 'HEALTH',
    label: 'Saúde e qualidade de vida',
    description: 'Como você se sente: energia, disposição e bem-estar.',
  },
  { value: 'BALANCED', label: 'Um pouco de tudo', description: 'Sem prioridade entre os três.' },
];

export const EVENT_ITEMS: OptionItem<TargetEvent['kind']>[] = [
  { value: 'RUNNING_RACE', label: 'Corrida' },
  { value: 'HYROX_RACE', label: 'HYROX' },
  { value: 'STRENGTH_EVENT', label: 'Fisiculturismo ou força' },
  { value: 'OTHER_EVENT', label: 'Outro esporte' },
];

// --- 3. Seu treino com a MOVIVO -------------------------------------------------------------

export type PracticedLevel = Exclude<ExperienceLevel, 'NONE'>;

/** Descrições curtas de cada nível, por modalidade, para o aluno se autoavaliar com mais precisão. */
export const LEVEL_ITEMS: Record<CoachedModality, DescribedOption<PracticedLevel>[]> = {
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
export const VENUE_LABELS: Record<CoachedModality, Partial<Record<TrainingVenue, string>>> = {
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

// --- 4. Sua semana --------------------------------------------------------------------------

export const SLOT_ITEMS: OptionItem<DaySlot>[] = [
  { value: 'MORNING', label: 'Manhã' },
  { value: 'AFTERNOON', label: 'Tarde' },
  { value: 'EVENING', label: 'Noite' },
  { value: 'ANY', label: 'Varia conforme o dia' },
];

/** Tempo disponível por treino (minutos); `90` representa "mais de 60 minutos". */
export const AVAILABLE_MINUTES_OPTIONS = ['30', '45', '60', '90'] as const;
export type AvailableMinutes = (typeof AVAILABLE_MINUTES_OPTIONS)[number];

export const AVAILABLE_LABELS: Record<AvailableMinutes, string> = {
  '30': 'Até 30 minutos',
  '45': 'Cerca de 45 minutos',
  '60': 'Cerca de 1 hora',
  '90': 'Mais de 1 hora',
};

export const STRESS_ITEMS = [
  { value: 'LOW', label: 'Baixo', description: 'Dias tranquilos, consigo relaxar com facilidade.' },
  {
    value: 'MODERATE',
    label: 'Moderado',
    description: 'Tenho momentos de tensão, mas dou conta da rotina.',
  },
  {
    value: 'HIGH',
    label: 'Alto',
    description: 'Me sinto sobrecarregado(a) com frequência.',
  },
] as const;

/** Quanto o esporte externo cansa; o valor gravado é a PSE (0 a 10). */
export const RPE_ITEMS: DescribedOption<string>[] = [
  { value: '3', label: 'Leve', description: 'Dá para conversar sem esforço.' },
  { value: '5', label: 'Moderada', description: 'Respiração acelerada, mas confortável.' },
  { value: '7', label: 'Intensa', description: 'Desafiadora, só consigo falar frases curtas.' },
  { value: '9', label: 'Muito intensa', description: 'Perto do meu limite, saio exausto(a).' },
];

// --- 5. Preferências ------------------------------------------------------------------------

export const PRIORITY_ITEMS: DescribedOption<
  OnboardingPreferencesStep['preferences']['priority']
>[] = [
  {
    value: 'MAX_RESULT',
    label: 'Puxado',
    description: 'Mais exigente, para buscar o melhor resultado possível.',
  },
  {
    value: 'BALANCED',
    label: 'Equilibrado',
    description: 'Desafiador, mas fácil de encaixar e manter na rotina.',
  },
  {
    value: 'ENJOYMENT',
    label: 'Leve e prazeroso',
    description: 'Mais tranquilo, para criar e manter o hábito.',
  },
];

// --- 6. Dores -------------------------------------------------------------------------------

export const TREND_ITEMS: OptionItem<PainTrend>[] = [
  { value: 'IMPROVING', label: 'Melhorando' },
  { value: 'STABLE', label: 'Sem mudança' },
  { value: 'WORSENING', label: 'Piorando' },
  { value: 'UNKNOWN', label: 'Não sei dizer' },
];

// --- 7. Alimentação -------------------------------------------------------------------------

type Nutrition = OnboardingNutritionStep;

export const RESTRICTION_ITEMS: OptionItem<Nutrition['dietaryRestrictions'][number]>[] = [
  { value: 'VEGETARIAN', label: 'Vegetariano' },
  { value: 'VEGAN', label: 'Vegano' },
  { value: 'LACTOSE_FREE', label: 'Sem lactose' },
  { value: 'GLUTEN_FREE', label: 'Sem glúten' },
  { value: 'HALAL', label: 'Halal' },
  { value: 'KOSHER', label: 'Kosher' },
];

export const SUPPLEMENT_ITEMS: OptionItem<Nutrition['supplements'][number]>[] = [
  { value: 'CREATINE', label: 'Creatina' },
  { value: 'WHEY', label: 'Whey ou outra proteína em pó' },
  { value: 'CAFFEINE', label: 'Cafeína' },
  { value: 'VITAMIN_D', label: 'Vitamina D' },
  { value: 'OMEGA_3', label: 'Ômega 3' },
  { value: 'MULTIVITAMIN', label: 'Multivitamínico' },
  { value: 'OTHER', label: 'Outro' },
];

export const HUNGER_ITEMS: OptionItem<Nutrition['hunger']>[] = [
  { value: 'LOW', label: 'Pouca fome' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'HIGH', label: 'Muita fome' },
  { value: 'VARIES', label: 'Varia bastante' },
];

export const SEVERITY_ITEMS: DescribedOption<Nutrition['allergies'][number]['severity']>[] = [
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

export const COOKING_ITEMS: DescribedOption<Nutrition['cookingCapacity']>[] = [
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

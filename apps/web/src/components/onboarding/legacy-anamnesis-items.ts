/**
 * Rótulos das respostas da anamnese ANTIGA (3 etapas), ainda lidos pelas telas legadas do painel
 * (detalhe do aluno e fila de protocolo). Saem junto com elas no M10; a anamnese nova usa os
 * contratos de `@movivo/shared/schemas/onboarding`.
 */
import type {
  ConsistencyBarrier,
  PastActivity,
  PreferredPeriod,
  SessionDuration,
  StoppedFor,
  TrainingExperience,
  TrainingStatus,
  Weekday,
} from '@movivo/shared';

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
export const PERIOD_ITEMS: { value: PreferredPeriod; label: string }[] = [
  { value: 'MORNING', label: 'Manhã' },
  { value: 'AFTERNOON', label: 'Tarde' },
  { value: 'NIGHT', label: 'Noite' },
  { value: 'VARIES', label: 'Varia conforme o dia' },
];

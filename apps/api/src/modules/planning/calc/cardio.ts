/**
 * Cardio de quem treina musculação (determinístico).
 *
 * Aluno que só quer musculação também precisa de atividade aeróbia: a OMS recomenda, para adultos,
 * 150 a 300 min/semana de atividade moderada (ou 75 a 150 min de vigorosa, ou uma combinação
 * equivalente) e musculação em 2 ou mais dias. O código calcula quanto cardio falta depois do que
 * o plano já tem (corrida e esporte externo) e quanto cabe nas sessões de musculação; o agente de
 * musculação distribui esse tempo nas sessões, escolhendo entre os exercícios de cardio JÁ
 * cadastrados no catálogo (esteira, elíptico, bicicleta, simulador de escadas, HIIT…).
 */

/** Referência da OMS (Diretrizes de atividade física e comportamento sedentário, 2020), adultos. */
export const WHO_CARDIO = {
  moderateMinutesMin: 150,
  moderateMinutesMax: 300,
  vigorousMinutesMin: 75,
  vigorousMinutesMax: 150,
  /** Minuto vigoroso vale dois moderados. */
  vigorousWeight: 2,
  strengthDaysMin: 2,
} as const;

/** Ponto de partida de quem está começando: sobe para a referência nos ciclos seguintes. */
const BEGINNER_WEEKLY_MINUTES = 100;
/** Perder gordura pede a parte mais alta da faixa de 150–300 min. */
const FAT_LOSS_WEEKLY_MINUTES = 200;
/**
 * A força vem primeiro: uma sessão de musculação mantém ao menos este tempo para a parte de força
 * (volume mínimo por grupo, descansos e aquecimento). Cardio dentro da sessão só usa o que sobra
 * acima disso; em sessão curta ele não entra e a meta se completa fora da academia.
 */
const MIN_STRENGTH_MINUTES = 40;
const MAX_CARDIO_PER_SESSION = 30;
const MIN_CARDIO_PER_SESSION = 10;

export type CardioIntensity = 'MODERATE' | 'VIGOROUS';

/**
 * Exercícios de cardio do catálogo que a musculação pode usar, com a intensidade típica. Fora
 * desta lista (corrida, natação, esportes, tração de trenó…) não é cardio de apoio à musculação:
 * corrida é do treinador de corrida e o resto é outra modalidade.
 */
export const CARDIO_PROFILE: Readonly<Record<string, CardioIntensity>> = {
  esteira: 'MODERATE',
  caminhada: 'MODERATE',
  eliptico: 'MODERATE',
  bicicleta_horizontal: 'MODERATE',
  ciclismo: 'MODERATE',
  simulador_de_escadas_andares: 'MODERATE',
  simulador_de_escadas_degraus: 'MODERATE',
  maquina_de_remo: 'MODERATE',
  aerobica: 'MODERATE',
  spinning: 'VIGOROUS',
  air_bike: 'VIGOROUS',
  ski_erg: 'VIGOROUS',
  corda_naval: 'VIGOROUS',
  hiit: 'VIGOROUS',
  pular_corda: 'VIGOROUS',
};

export interface CardioInput {
  /** Objetivos declarados (principal e secundários), no vocabulário da anamnese. */
  goals: readonly string[];
  /** Nível de quem faz musculação; iniciante começa com menos. */
  beginner: boolean;
  /** Sessões de musculação por semana. */
  strengthSessions: number;
  /** Tempo de cada sessão de musculação, em minutos. */
  minutesPerSession: number;
  /** Minutos por semana que o plano já tem de corrida (conta como cardio). */
  runningMinutesPerWeek: number;
  /** Minutos por semana de esporte que o aluno já pratica por fora. */
  externalMinutesPerWeek: number;
}

export interface CardioPrescription {
  /** Meta semanal em minutos de atividade moderada (ou equivalente vigoroso). */
  targetMinutes: number;
  /** Já coberto por corrida e esporte externo. */
  coveredMinutes: number;
  /** Cardio a prescrever DENTRO das sessões de musculação, por semana. */
  weeklyMinutes: number;
  /** Faixa de cardio por sessão de musculação. */
  perSession: { min: number; max: number };
  /** Parte da meta que não cabe nas sessões: o aluno completa com caminhadas no dia a dia. */
  leftoverMinutes: number;
}

const FAT_LOSS_GOALS = new Set(['FAT_LOSS', 'BODY_DEFINITION']);

export function weeklyCardioTarget(input: Pick<CardioInput, 'goals' | 'beginner'>): number {
  if (input.beginner) return BEGINNER_WEEKLY_MINUTES;
  const fatLoss = input.goals.some((goal) => FAT_LOSS_GOALS.has(goal));
  return Math.min(
    WHO_CARDIO.moderateMinutesMax,
    fatLoss ? FAT_LOSS_WEEKLY_MINUTES : WHO_CARDIO.moderateMinutesMin,
  );
}

const roundTo5 = (minutes: number) => Math.round(minutes / 5) * 5;

export function cardioPrescription(input: CardioInput): CardioPrescription {
  const target = weeklyCardioTarget(input);
  const covered = Math.round(input.runningMinutesPerWeek + input.externalMinutesPerWeek);
  const missing = Math.max(0, target - covered);

  const room = Math.min(MAX_CARDIO_PER_SESSION, input.minutesPerSession - MIN_STRENGTH_MINUTES);
  const perSessionMax = room >= MIN_CARDIO_PER_SESSION ? Math.floor(room / 5) * 5 : 0;
  const capacity = input.strengthSessions * perSessionMax;

  const weeklyMinutes = missing === 0 || capacity === 0 ? 0 : roundTo5(Math.min(missing, capacity));
  return {
    targetMinutes: target,
    coveredMinutes: covered,
    weeklyMinutes,
    perSession: {
      min: weeklyMinutes > 0 ? MIN_CARDIO_PER_SESSION : 0,
      max: weeklyMinutes > 0 ? perSessionMax : 0,
    },
    leftoverMinutes: Math.max(0, missing - weeklyMinutes),
  };
}

/**
 * Escada de silêncio: o que a MOVIVO faz quando o aluno some. Um coach humano percebe em poucos
 * dias, muda a abordagem a cada tentativa e, quando nada funciona, pede ajuda a quem pode olhar
 * a pessoa por inteiro. Aqui ficam as regras puras (quando subir um degrau); o serviço lê os
 * dados, os agentes escolhem a abordagem e a persona conversa.
 *
 *   degrau 1 (3 dias sem sinal)   acolhimento leve: "senti sua falta, está tudo bem?"
 *   degrau 2 (6 dias)             remover fricção: oferecer a SEMANA MÍNIMA (poucos treinos curtos)
 *   degrau 3 (10 dias)            conversa direta e pessoal; a equipe é avisada (Alertas)
 *   degrau 4 (21 dias)            porta aberta: a retomada sem culpa; último contato, sem insistir
 *
 * "Sinal" é qualquer coisa que o aluno faz: mensagem, check-in, refeição, peso, treino.
 */

export interface SilenceStep {
  level: 1 | 2 | 3 | 4;
  /** Dias sem nenhum sinal para o degrau valer. */
  minDays: number;
  /** Abordagens que o especialista pode escolher nesse degrau. */
  strategies: readonly SilenceStrategy[];
}

export const SILENCE_STRATEGIES = [
  'WARM_CHECK_IN',
  'REMOVE_FRICTION',
  'MINIMUM_VERSION',
  'RESET_GOAL',
  'PERSONAL_TOUCH',
  'OPEN_DOOR',
] as const;
export type SilenceStrategy = (typeof SILENCE_STRATEGIES)[number];

export const SILENCE_STEPS: readonly SilenceStep[] = [
  { level: 1, minDays: 3, strategies: ['WARM_CHECK_IN', 'REMOVE_FRICTION'] },
  { level: 2, minDays: 6, strategies: ['MINIMUM_VERSION', 'REMOVE_FRICTION', 'RESET_GOAL'] },
  { level: 3, minDays: 10, strategies: ['PERSONAL_TOUCH', 'MINIMUM_VERSION', 'RESET_GOAL'] },
  { level: 4, minDays: 21, strategies: ['OPEN_DOOR'] },
];

/** A equipe é avisada a partir deste degrau (auditoria humana, sem travar os agentes). */
export const TEAM_ALERT_FROM_LEVEL = 3;

/** Maior degrau que os dias de silêncio já alcançaram (0 = ainda dentro do normal). */
export function reachedLevel(daysSilent: number): 0 | 1 | 2 | 3 | 4 {
  let level: 0 | 1 | 2 | 3 | 4 = 0;
  for (const step of SILENCE_STEPS) if (daysSilent >= step.minDays) level = step.level;
  return level;
}

export interface SilenceOutreach {
  level: number | null;
  sentAt: Date;
}

/**
 * Degrau a enviar agora, ou `null`. Um degrau só sai uma vez por episódio de silêncio (o episódio
 * recomeça quando o aluno dá algum sinal) e nunca com menos de 2 dias do contato anterior.
 */
export function levelToSend(input: {
  daysSilent: number;
  lastSignalAt: Date | null;
  outreaches: readonly SilenceOutreach[];
  now: Date;
}): SilenceStep['level'] | null {
  const reached = reachedLevel(input.daysSilent);
  if (reached === 0) return null;
  const episode = input.outreaches.filter(
    (o) => o.level !== null && (input.lastSignalAt === null || o.sentAt > input.lastSignalAt),
  );
  const highestSent = Math.max(0, ...episode.map((o) => o.level ?? 0));
  if (highestSent >= reached) return null;
  const last = episode.reduce<Date | null>(
    (latest, o) => (latest === null || o.sentAt > latest ? o.sentAt : latest),
    null,
  );
  if (last && input.now.getTime() - last.getTime() < 2 * 86_400_000) return null;
  // Sobe um degrau por vez: quem estava em 0 recebe o 1, mesmo que já tenha passado dos 6 dias.
  return Math.min(reached, highestSent + 1) as SilenceStep['level'];
}

export function stepOf(level: SilenceStep['level']): SilenceStep {
  const step = SILENCE_STEPS.find((s) => s.level === level);
  if (!step) throw new Error(`degrau de silêncio desconhecido: ${level}`);
  return step;
}

/** Dias inteiros entre duas datas ISO (yyyy-mm-dd). */
export function daysBetween(from: string, to: string): number {
  return Math.max(
    0,
    Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000),
  );
}

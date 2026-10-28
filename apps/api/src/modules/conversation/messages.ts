/**
 * Textos do comunicador. Guardrails de linguagem da MOVIVO: sem diagnóstico, tratamento, cura,
 * promessa de resultado, culpa ou comparação; o respaldo dos profissionais fica visível e a IA
 * não aparece como quem decide. As ações executadas são descritas em texto fixo (verificável);
 * só a resposta de dúvida vem do modelo.
 */
import { WHATSAPP_BUBBLE_SEPARATOR } from '../jobs/whatsapp-outbound.contract';

export const EMERGENCY_MESSAGE =
  'O que você descreveu pode ser sério. Pare qualquer atividade agora e procure atendimento médico imediatamente (SAMU 192 ou o pronto-socorro mais próximo). Já avisei a equipe de profissionais da MOVIVO e vamos falar com você assim que possível.';

/** Tema que o profissional responsável marcou como fora do que o atendimento automático trata. */
export const FORBIDDEN_TOPIC_MESSAGE =
  'Esse assunto eu prefiro não tratar por aqui. Vou pedir para um profissional da equipe te orientar.';

export const ESCALATED_MESSAGE =
  'Isso eu prefiro deixar com a equipe de profissionais da MOVIVO. Já encaminhei o seu caso com tudo que você contou, e eles retornam por aqui. Enquanto isso, vá com calma e priorize como você se sente.';

export const HUMAN_REVIEW_MESSAGE =
  'Combinado: pedi a revisão de uma pessoa da equipe de profissionais da MOVIVO. Ela vai olhar o que foi decidido e o motivo, e responde por aqui. Até lá, as mudanças automáticas no seu plano ficam em espera.';

export const PAIN_MESSAGE =
  'Obrigado por contar. Por segurança, vamos com calma: evite o movimento que provoca a dor até a equipe avaliar. Avisei os profissionais da MOVIVO e eles retornam por aqui. Se a dor piorar ou aparecer outro sintoma, procure atendimento.';

export const OUT_OF_SCOPE_MESSAGE =
  'Esse assunto foge do que eu consigo ajudar por aqui: treino, alimentação e o seu plano. Se quiser, me conta como estão os treinos ou o que precisa ajustar na semana.';

export const GREETING_MESSAGE =
  'Oi! Tudo bem? Posso ajustar o seu treino, a semana ou a alimentação, ou tirar uma dúvida. Como posso ajudar?';

export const FALLBACK_MESSAGE = 'Recebi sua mensagem e já te respondo.';

const WEEKDAY_NAMES: Record<string, string> = {
  MON: 'segunda',
  TUE: 'terça',
  WED: 'quarta',
  THU: 'quinta',
  FRI: 'sexta',
  SAT: 'sábado',
  SUN: 'domingo',
};

export function weekdayName(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][day] ?? '';
}

export function weekdayList(weekdays: readonly string[]): string {
  const names = weekdays.map((d) => WEEKDAY_NAMES[d] ?? d);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} e ${names.at(-1)}`;
}

export function rescheduledMessage(
  items: readonly { title: string; date: string }[],
  dropped: readonly string[],
): string {
  const lines = items.map((i) => `${weekdayName(i.date)}: ${i.title}`).join('; ');
  const out = dropped.length
    ? `${WHATSAPP_BUBBLE_SEPARATOR}${dropped.join(' e ')} não coube${dropped.length > 1 ? 'ram' : ''} nesta semana e ficou de fora. Sem problema: a gente segue do que dá.`
    : '';
  return `Fechado! Reorganizei a sua semana. ${lines}.${out}`;
}

export const NOTHING_TO_MOVE_MESSAGE =
  'Já vi aqui: o seu plano continua cabendo nessa agenda, não precisei mudar nada.';

export function shortenedMessage(
  title: string,
  minutes: number,
  link: string,
  requestedMinutes: number,
): string {
  const base = `Combinado: o treino de hoje (${title}) ficou em cerca de ${minutes} min, mantendo o que mais importa.`;
  const limit =
    minutes > requestedMinutes
      ? ` Esse é o máximo que consigo encurtar sozinho; se ainda não couber, é só me avisar que a equipe avalia.`
      : '';
  return `${base}${limit} Abra aqui: ${link}`;
}

export const ALREADY_FITS_MESSAGE = 'O treino de hoje já cabe nesse tempo, pode seguir como está.';

export function swappedMessage(
  from: string,
  to: string,
  scope: 'NEXT_SESSION' | 'PLAN',
  why: string,
): string {
  const when = scope === 'PLAN' ? 'no seu plano' : 'só no próximo treino';
  return `Troquei ${from} por ${to} ${when}. ${why}`;
}

export const SWAP_NOT_FOUND_MESSAGE =
  'Qual exercício você quer trocar? Me diga o nome como aparece no seu treino.';

export const SWAP_NO_EQUIVALENT_MESSAGE =
  'Não encontrei um equivalente seguro para esse exercício. Deixei com a equipe de profissionais da MOVIVO, que retorna por aqui.';

export function foodDraftMessage(
  items: readonly { label: string; grams: number }[],
  link: string,
): string {
  const list = items.map((i) => `${i.label} (${i.grams} g)`).join(', ');
  return `Anotei como rascunho: ${list}.${WHATSAPP_BUBBLE_SEPARATOR}Confira e confirme aqui para contar no seu dia: ${link}`;
}

export const FOOD_CLARIFICATION_FALLBACK =
  'Não entendi bem o que você comeu. Pode me dizer os alimentos e, se souber, a quantidade?';

export const NO_SESSION_TODAY_MESSAGE =
  'Hoje você não tem treino marcado no plano, então não há o que encurtar.';

export function linkMessage(link: string): string {
  return `Aqui está o seu link: ${link}`;
}

export function workoutReportMessage(link: string): string {
  return `Que bom que você contou! Para o treino contar de verdade no seu acompanhamento, registre aqui (leva um minuto): ${link}`;
}

export const ASK_AVAILABLE_DAYS_MESSAGE = 'Em quais dias você consegue treinar nesta semana?';

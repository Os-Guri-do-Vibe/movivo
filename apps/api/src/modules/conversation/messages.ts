/**
 * Textos do comunicador. Guardrails de linguagem da MOVIVO: sem diagnóstico, tratamento, cura,
 * promessa de resultado, culpa ou comparação; o respaldo dos profissionais fica visível e a IA
 * não aparece como quem decide. As ações executadas são descritas em texto fixo (verificável);
 * só a resposta de dúvida vem do modelo.
 */
import { WHATSAPP_BUBBLE_SEPARATOR } from '../jobs/whatsapp-outbound.contract';

export const EMERGENCY_MESSAGE =
  'O que você descreveu pode ser sério. Pare qualquer atividade agora e procure atendimento médico imediatamente (SAMU 192 ou o pronto-socorro mais próximo). Já avisei a equipe de profissionais da MOVIVO e vamos falar com você assim que possível.';

/**
 * Tema que o profissional responsável marcou como fora do atendimento: a conversa sobre ele se
 * encerra e o aluno é convidado, com educação, a voltar ao foco da MOVIVO e aos objetivos dele.
 */
export const FORBIDDEN_TOPIC_MESSAGE =
  'Esse é um assunto que eu não trato por aqui, tudo bem? O meu foco é cuidar do seu treino, da sua alimentação, dos seus hábitos e dos seus objetivos. Me conta: como posso te ajudar com isso hoje?';

export const ESCALATED_MESSAGE =
  'Isso eu prefiro deixar com a equipe de profissionais da MOVIVO. Já encaminhei o seu caso com tudo que você contou, e eles retornam por aqui. Enquanto isso, vá com calma e priorize como você se sente.';

export const HUMAN_REVIEW_MESSAGE =
  'Combinado: pedi a revisão de uma pessoa da equipe de profissionais da MOVIVO. Ela vai olhar o que foi decidido e o motivo, e responde por aqui. Até lá, as mudanças automáticas no seu plano ficam em espera.';

export const PAIN_MESSAGE =
  'Obrigado por contar. Por segurança, vamos com calma: evite o movimento que provoca a dor até a equipe avaliar. Avisei os profissionais da MOVIVO e eles retornam por aqui. Se a dor piorar ou aparecer outro sintoma, procure atendimento.';

export const OUT_OF_SCOPE_MESSAGE =
  'Esse assunto foge do que eu acompanho por aqui. Posso te ajudar com treino (de qualquer modalidade), alimentação, hábitos, sono, recuperação e bem-estar. Me conta como estão os treinos ou o que você quer ajustar na sua rotina.';

/** Apresenta a persona como IA (transparência): nunca como pessoa. */
export const greetingMessage = ({ name, article }: { name: string; article: 'a' | 'o' }) =>
  `Oi! Aqui é ${article} ${name}, assistente de IA da MOVIVO, com a equipe de profissionais por trás. Posso ajustar o seu treino, a semana ou a alimentação, ou tirar uma dúvida. Como posso ajudar?`;

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

export function swapScopeQuestion(from: string, to: string): string {
  return `Posso trocar ${from} por ${to}. Você quer fazer essa troca só no treino de hoje, ou quer que eu atualize o seu protocolo com essa substituição?`;
}

/** Troca só de hoje: nada muda no protocolo, o aluno apenas é orientado a fazer a troca na sessão. */
export function swapTodayMessage(from: string, to: string, why: string): string {
  return `Combinado! No treino de hoje, faça ${to} no lugar de ${from}. ${why} O seu protocolo continua como está.`;
}

export const SWAP_DECLINED_MESSAGE = 'Tudo bem, deixei o seu treino como está.';

/** Troca no protocolo que passou a fila do profissional (revisão opcional, liberada sozinha). */
export function swapQueuedMessage(from: string, to: string): string {
  return `Combinado! A troca de ${from} por ${to} no seu protocolo passa por uma checagem rápida da equipe e, em poucos minutos, te envio o protocolo atualizado.`;
}

/** Troca no protocolo que só um profissional libera (aluno com PAR-Q de risco). */
export function swapPendingReviewMessage(from: string, to: string): string {
  return `Anotei a troca de ${from} por ${to} no seu protocolo. Um profissional da MOVIVO precisa revisar antes; assim que liberar, te envio o protocolo atualizado.`;
}

/** Troca no protocolo liberada pela equipe (ou pela janela): o protocolo atualizado vai junto. */
export function swapReleasedMessage(from: string, to: string, link: string): string {
  return `Pronto! Troquei ${from} por ${to} no seu protocolo. Aqui está o treino atualizado: ${link}`;
}

export const SWAP_REJECTED_MESSAGE =
  'A equipe avaliou a troca que você pediu e, por enquanto, o exercício continua como está no seu protocolo. Se quiser, me diga outro exercício que incomoda.';

/** A equipe alterou o protocolo que já estava em uso. */
export function protocolAmendedMessage(kind: 'TRAINING' | 'NUTRITION', link: string): string {
  const what = kind === 'TRAINING' ? 'o seu plano de treino' : 'o seu plano alimentar';
  return `A equipe da MOVIVO atualizou ${what}. Veja como ficou: ${link}`;
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

export const FOOD_QUERY_CLARIFICATION =
  'De qual alimento ou refeição você quer saber? Me diga o que é e, se souber, a quantidade.';

export const NO_SESSION_TODAY_MESSAGE =
  'Hoje você não tem treino marcado no plano, então não há o que encurtar.';

export function linkMessage(link: string): string {
  return `Aqui está o seu link: ${link}`;
}

export function workoutReportMessage(link: string): string {
  return `Que bom que você contou! Para o treino contar de verdade no seu acompanhamento, registre aqui (leva um minuto): ${link}`;
}

export const ASK_AVAILABLE_DAYS_MESSAGE = 'Em quais dias você consegue treinar nesta semana?';

export const NO_NUTRITION_PLAN_MESSAGE =
  'Você ainda não tem um plano alimentar ativo por aqui. Assim que ele estiver pronto, eu consigo sugerir opções de refeição dentro dele.';

export function askMealMessage(labels: readonly string[]): string {
  return `Para qual refeição você quer a sugestão? No seu plano: ${labels.join(', ')}.`;
}

export const MEAL_SUGGESTION_FAILED_MESSAGE =
  'Não consegui montar uma boa opção agora. Me diga o que você tem em casa para essa refeição que eu monto com isso, ou fale com a equipe.';

export const ASK_WATER_AMOUNT_MESSAGE = 'Quanto de água foi? Pode dizer em ml, copos ou garrafas.';

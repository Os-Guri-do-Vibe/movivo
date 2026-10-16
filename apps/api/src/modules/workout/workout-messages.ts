/**
 * Copy do treino diário (US-8.1 / TASK-8.1.3).
 *
 * Achado 2026-09-12 (decisão do fundador): o quick reply "Treinei ✅"/"Hoje não" (US-8.1
 * original) foi REMOVIDO — nunca chegou a ser enviado por nenhum scheduler (o texto, os
 * botões e o parser existiam, mas nada os enfileirava), e a definição de "treinou" deixou
 * de admitir qualquer canal de WhatsApp: só o diário de treino web conta
 * (`workout_sessions.status = 'COMPLETED'`, ver `WorkoutJournalService.finish()`).
 *
 * # Guardrail de linguagem (inegociável — `CLAUDE.md`)
 * Toda string daqui fala de **treino registrado**, nunca de "evolução do quadro",
 * "progresso clínico", "diagnóstico", "tratamento" ou promessa de resultado. E a IA
 * nunca aparece como autoridade: o enquadramento é sempre acompanhamento **com a
 * metodologia do profissional CREF**, com a IA como ferramenta. `workout-messages.spec.ts`
 * varre estas constantes contra a lista de termos proibidos — não editar a copy sem
 * rodar aquele teste.
 */
import { whatsappBold as bold } from '../../core/text/whatsapp-format';
import {
  WHATSAPP_BUBBLE_SEPARATOR,
  type WhatsappQuickReplyButton,
} from '../jobs/whatsapp-outbound.contract';

/**
 * Pergunta sobre o treino que ficou sem registro, logo depois do link do dia (pedido do
 * fundador, 2026-10-13; desenho da Sofia): vai no MESMO envio das 04:00, mas em um BALÃO
 * SEPARADO. O balão do link fica exatamente como sempre foi; a pergunta é um segundo balão,
 * como um treinador que manda o treino e, em seguida, pergunta como foi o dia anterior. Não é
 * uma segunda mensagem proativa em outro horário (no canal não oficial, isso aumentaria o
 * risco de bloqueio do número) e, de manhã, o dia anterior já fechou: não há "ainda dá tempo".
 */
export interface DailyWorkoutYesterday {
  /** Foco da sessão sem registro ("Costas e Bíceps"), nunca o rótulo interno "Dia A". */
  focus: string;
  /** "ontem" ou o dia da semana curto ("sexta"), sempre verdadeiro no momento do envio. */
  when: string;
  /** Escolhe a variação (a data do treino sem registro): o retry reenvia a mesma copy. */
  seed: string;
}

type YesterdayVariant = (focus: string, when: string) => string;

/**
 * Três variações do balão da pergunta (parágrafo + fecho). Tom do manifesto: ninguém precisa
 * ser perfeito, precisa voltar. Sem cobrança, sem "compensar", sem as palavras que a marca
 * nunca usa (preguiça, falhou, perdeu, "sem desculpa").
 */
const YESTERDAY_VARIANTS: readonly [YesterdayVariant, ...YesterdayVariant[]] = [
  (focus, when) =>
    `E ${when}, tudo bem? O treino de ${focus} ficou sem registro. Se quiser, me conta o que rolou, uma palavra já ajuda.\n\nNinguém precisa ser perfeito. Precisa voltar, e hoje é um ótimo dia pra isso. 👊🏼`,
  (focus, when) =>
    `O treino de ${when} (${focus}) ficou sem registro. Quer me contar como foi o seu dia? Pode ser curtinho, uma palavra já ajuda.\n\nConstância não é nunca parar, é sempre voltar. O treino de hoje já é esse passo. 💪🏼`,
  (focus, when) =>
    `${when.charAt(0).toUpperCase()}${when.slice(1)} o treino de ${focus} ficou sem registro. Como foi por aí? Se quiser me contar, uma palavra já ajuda.\n\nNinguém precisa ser perfeito pra seguir em frente, só precisa voltar. A gente segue junto. 👊🏼`,
];

/** O balão do link do dia: sempre este texto, com ou sem a pergunta. */
export function dailyWorkoutMessage(
  firstName: string,
  workoutTitle: string,
  link: string,
  yesterday?: DailyWorkoutYesterday,
): string {
  const linkBubble = `Bom dia, ${bold(firstName)}! 💚\n\nSeu treino de hoje é ${bold(workoutTitle)}, não esqueça de realizar seu check-in diário quando for treinar:\n${link}\n\nAgora é com você. Bora se mover. 👊🏼`;
  if (!yesterday) return linkBubble;
  const index = [...yesterday.seed].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const variant = YESTERDAY_VARIANTS[index % YESTERDAY_VARIANTS.length] ?? YESTERDAY_VARIANTS[0];
  return [linkBubble, variant(bold(yesterday.focus), yesterday.when)].join(
    WHATSAPP_BUBBLE_SEPARATOR,
  );
}

/** Novo link pedido pelo aluno quando o anterior já tinha sido aberto (ex.: guia anônima). */
export function resentWorkoutLinkMessage(firstName: string, link: string): string {
  return `Oi, ${bold(firstName)}! 💚\n\nAqui está o seu novo link para o check-in de hoje:\n${link}\n\nAbra no navegador de sempre (não em guia anônima) para ele seguir funcionando. 👊🏼`;
}

export function durationInsightMessage(observed: number, expected: number): string {
  return `Percebemos que seus ultimos treinos duraram em media ${observed} min, acima dos ${expected} min informados. Quer que o profissional CREF avalie um ajuste ou esse tempo esta tranquilo?`;
}

export function durationInsightButtons(insightId: string): readonly WhatsappQuickReplyButton[] {
  return [
    { id: `workout-insight:${insightId}:ADJUST`, title: 'Quero ajustar' },
    { id: `workout-insight:${insightId}:OK`, title: 'Esta tranquilo' },
  ];
}

const INSIGHT_PATTERN = /^workout-insight:([0-9a-f-]{36}):(ADJUST|OK)$/i;

export function parseDurationInsightButton(buttonId: string | undefined) {
  const match = buttonId ? INSIGHT_PATTERN.exec(buttonId) : null;
  return match?.[1] ? { id: match[1], adjust: match[2] === 'ADJUST' } : null;
}

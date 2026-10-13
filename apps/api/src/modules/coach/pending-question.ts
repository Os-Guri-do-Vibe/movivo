/**
 * Pergunta pendente do Coach (treino sem registro) — leitura determinística da resposta e
 * bloco de contexto para o modelo. Funções puras, sem I/O.
 *
 * Por que o servidor decide, e não o LLM: "trabalhei" é uma resposta perfeita à pergunta
 * "o que aconteceu?" e, sem a pergunta no contexto, uma mensagem solta que a classificação de
 * intenção lê como relato de treino (e manda celebrar) ou papo casual. O servidor sabe QUAL
 * pergunta está aberta e há quanto tempo; o modelo recebe isso pronto e só escreve o texto.
 * O fechamento da pendência também é do servidor (lista fechada de rótulos, nunca texto livre).
 *
 * # Guardrail de linguagem
 * O bloco é dado do sistema, não copy para o aluno: ainda assim usa só "sem registro" e nunca
 * "perdeu", "faltou" ou "falhou" (vocabulário da marca).
 */

export type PendingMatch = 'STRONG' | 'WEAK' | 'NONE';

/** Rótulo que o servidor entrega ao modelo para a leitura da mensagem atual. */
export const PENDING_READING: Readonly<Record<PendingMatch, string>> = {
  STRONG: 'PROVAVEL_RESPOSTA',
  WEAK: 'TALVEZ',
  NONE: 'SEM_RELACAO_APARENTE',
};

export interface PendingQuestion {
  /** Dia civil (`YYYY-MM-DD`, fuso do aluno) do treino sobre o qual a pergunta trata. */
  subjectDate: string;
  /** Foco da prescrição ("Costas e Bíceps"). */
  topicLabel: string;
  /** Momento em que o WhatsApp confirmou o envio da pergunta. */
  deliveredAt: Date;
}

export interface PendingReading {
  match: PendingMatch;
  /** A mensagem fala de dor/lesão como motivo: vira alerta ao profissional CREF. */
  mentionsPain: boolean;
}

// --- utilidades de data/hora no fuso do aluno ---------------------------------------------

function localDay(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function localHour(date: Date, timezone: string): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return Number.parseInt(hour, 10);
}

function dayNumber(day: string): number {
  return Math.round(Date.parse(`${day}T12:00:00.000Z`) / 86_400_000);
}

function weekdayName(day: string): string {
  return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(`${day}T12:00:00.000Z`),
  );
}

/** "no sábado" / "na segunda-feira". */
function onWeekday(day: string): string {
  const name = weekdayName(day);
  return `${name.endsWith('-feira') ? 'na' : 'no'} ${name}`;
}

function shortDate(day: string): string {
  const [, month, dayOfMonth] = day.split('-');
  return `${dayOfMonth}/${month}`;
}

function partOfDay(hour: number): string {
  // O link do dia sai às 04:00: para quem o recebe é "cedo", não "de madrugada".
  if (hour < 8) return 'cedo';
  if (hour < 12) return 'de manhã';
  if (hour < 18) return 'à tarde';
  return 'à noite';
}

/** Há quanto tempo a pergunta foi feita, sempre verdadeiro NO MOMENTO da resposta. */
export function describeAskedAt(deliveredAt: Date, now: Date, timezone: string): string {
  const minutes = Math.floor((now.getTime() - deliveredAt.getTime()) / 60_000);
  if (minutes < 1) return 'agora há pouco';
  if (minutes < 60) return `há ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
  const sentDay = localDay(deliveredAt, timezone);
  const today = localDay(now, timezone);
  const part = partOfDay(localHour(deliveredAt, timezone));
  const diff = dayNumber(today) - dayNumber(sentDay);
  if (diff <= 0) return `hoje ${part}`;
  if (diff === 1) return `ontem ${part}`;
  return `há ${diff} dias, ${onWeekday(sentDay)} ${part}`;
}

/** O treino sobre o qual a pergunta trata, em linguagem que o aluno reconhece. */
export function describeSubject(subjectDate: string, now: Date, timezone: string): string {
  const diff = dayNumber(localDay(now, timezone)) - dayNumber(subjectDate);
  const when = diff === 0 ? 'hoje' : diff === 1 ? 'ontem' : weekdayName(subjectDate);
  return `o treino de ${when} (${shortDate(subjectDate)})`;
}

// --- leitura da mensagem -------------------------------------------------------------------

/** Minúsculas e sem acento: os padrões abaixo não repetem variantes acentuadas. */
function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** "não consegui", "não fiz", "não deu": a negação do treino. */
const NEGATED_TRAINING =
  /\bnao\s+(?:consegui|deu|fiz|fui|treinei|rolou|tive\s+tempo|pude|apareci)\b/;
const SKIPPED = /\b(?:faltei|pulei|sumi|furei)\b/;
const MAKEUP_ASK = /\b(?:compensar|repor)\b/;
/** Contexto de treino que torna "não consegui…" inequívoco numa mensagem longa. */
const TRAINING_NOUN = /\b(?:treino|treinar|treinei|academia|malhar|malhei|aula|ontem|dia)\b/;
const CLAIMED_DONE =
  /\b(?:treinei\s+sim|fiz\s+sim|fiz,?\s+(?:so\s+)?nao\s+(?:marquei|registrei)|esqueci\s+de\s+(?:marcar|registrar|finalizar))\b/;
const PAIN = /\b(?:dor|dores|doeu|doendo|doi|machuc\w*|lesao|lesionei|torci|distens\w*)\b/;
const REASON =
  /\b(?:trabalh\w*|servico|trampo|plantao|reuniao|correria|cansad[oa]s?|cansaco|exaust\w*|morto|morta|dormi|sono|doente|gripe|gripad[oa]|febre|resfri\w*|viag\w*|chuva|chovendo|filh[oa]s?|familia|faculdade|prova|imprevisto|esqueci|sem\s+tempo|sem\s+energia|desanim\w*|sem\s+vontade|ocupad[oa]|estress\w*|pregui\w*|sem\s+pique|corrido|transito|feriado|festa|aniversario)\b|\b(?:semana|dia|rotina|mes)\s+corrid[oa]\b|\bacordei\s+tarde\b|\bacademia\s+(?:fechada|lotada)\b/;
const STOPWORDS = new Set(['para', 'com', 'sem', 'das', 'dos', 'nas', 'nos', 'uma', 'por']);

function focusWords(topicLabel: string): string[] {
  return normalize(topicLabel)
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word));
}

/**
 * A mensagem cita o dia da pergunta? Pelo dia da semana ("sábado"), por "ontem" (só quando for
 * verdade) ou por uma palavra do foco ("costas"). Com dor na mensagem as palavras do foco NÃO
 * contam: "tô com dor nas costas" fala do corpo, não do treino de costas sem registro.
 */
function citesPendingDay(
  normalized: string,
  pending: PendingQuestion,
  now: Date,
  timezone: string,
  allowFocusWords: boolean,
): boolean {
  const diff = dayNumber(localDay(now, timezone)) - dayNumber(pending.subjectDate);
  const weekday = normalize(weekdayName(pending.subjectDate)).replace('-feira', '');
  if (new RegExp(`\\b${weekday}(?:-feira)?\\b`).test(normalized)) return true;
  if (diff === 1 && /\bontem\b/.test(normalized)) return true;
  return (
    allowFocusWords && focusWords(pending.topicLabel).some((word) => normalized.includes(word))
  );
}

/**
 * Lê a mensagem do aluno contra a pergunta pendente.
 *  - `STRONG`: negou ou admitiu o treino sem registro, pediu para compensar, ou citou o dia da
 *    pergunta junto de um motivo.
 *  - `WEAK`: só um motivo solto ("trabalhei"), ou disse que treinou e não registrou.
 *  - `NONE`: nada indica que seja a resposta, incluindo "fiz o treino de hoje!" e qualquer
 *    mensagem que fale de "hoje" sem citar o dia da pergunta.
 */
export function matchPendingReply(
  message: string,
  pending: PendingQuestion,
  now: Date,
  timezone: string,
): PendingReading {
  const normalized = normalize(message);
  const mentionsPain = PAIN.test(normalized);
  const hasReason = REASON.test(normalized) || mentionsPain;
  const words = normalized.split(/\s+/).filter(Boolean).length;

  const negated = NEGATED_TRAINING.test(normalized) || SKIPPED.test(normalized);
  const citesDay = citesPendingDay(normalized, pending, now, timezone, !mentionsPain);
  // "não consegui" solto numa frase longa pode ser outra coisa ("não consegui entender o
  // exercício"): só vale como resposta se for curto ou falar de treino ou do dia da pergunta.
  const negatedAboutTraining =
    negated && (words <= 6 || TRAINING_NOUN.test(normalized) || citesDay);

  // A pergunta chega pela manhã, junto do link de HOJE: "hoje" quase sempre fala do treino de
  // hoje ("hoje não vai dar"), não do dia sem registro. Só é resposta se também cita o dia da
  // pergunta ("ontem não deu, mas hoje eu vou").
  if (/\bhoje\b/.test(normalized) && !citesDay) return { match: 'NONE', mentionsPain: false };

  if (negatedAboutTraining || MAKEUP_ASK.test(normalized) || (citesDay && hasReason)) {
    return { match: 'STRONG', mentionsPain };
  }
  if (hasReason || (CLAIMED_DONE.test(normalized) && !/\bhoje\b/.test(normalized))) {
    return { match: 'WEAK', mentionsPain };
  }
  return { match: 'NONE', mentionsPain: false };
}

/**
 * Bloco `PERGUNTA_PENDENTE` entregue ao modelo (envelope próprio, DEPOIS de tudo que é
 * cacheável: os rótulos relativos mudam a cada hora e, dentro do `ESTADO`, invalidariam o
 * prefixo do aluno a cada mensagem). As regras de uso moram no system prompt, sempre.
 */
export function buildPendingBlock(
  pending: PendingQuestion,
  reading: PendingMatch,
  now: Date,
  timezone: string,
): string {
  const today = localDay(now, timezone);
  return [
    'PERGUNTA_PENDENTE (escrito pelo sistema, não pelo aluno):',
    `voce_perguntou: ${describeAskedAt(pending.deliveredAt, now, timezone)}, logo depois do link do treino`,
    `sobre: ${describeSubject(pending.subjectDate, now, timezone)}, foco ${pending.topicLabel}, que ficou sem registro`,
    `leitura_do_servidor: ${PENDING_READING[reading]}`,
    `hoje: ${weekdayName(today)} (${shortDate(today)})`,
  ].join('\n');
}

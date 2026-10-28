/**
 * Mensagens de simples confirmação ("ok", "👌", "🫡🫡", "valeu") não são um turno novo.
 *
 * Achado 2026-10-16 (conversas reais de alunos): o aluno mandava a pergunta e, em seguida, um
 * emoji de "beleza" — o lote juntava os dois e a IA respondia ao emoji com um fecho
 * ("Tudo certo então. Quando o profissional liberar…"), em bolha separada. Um "ok" sozinho
 * recebia "Fechado então. Qualquer coisa é só chamar". Para o aluno, a IA parecia
 * responder a algo que ele não disse.
 *
 * A detecção é deliberadamente conservadora: só vale texto curto, sem pergunta, feito de
 * confirmações conhecidas e emojis positivos/neutros. Qualquer palavra fora do vocabulário,
 * e qualquer emoji fora da lista (😭, 🤕, 😡 podem ser relato), mantém a mensagem no fluxo
 * normal. Saudação ("oi", "bom dia") nunca é confirmação.
 */

const MAX_ACK_CHARS = 40;

/** Emojis de confirmação positivos ou neutros. 👋 fica de fora: pode ser a saudação inicial. */
const ACK_EMOJI = new Set(
  [
    0x1f44d, // 👍
    0x1f44c, // 👌
    0x1fae1, // 🫡
    0x1f64f, // 🙏
    0x1f44a, // 👊
    0x1f4aa, // 💪
    0x2705, // ✅
    0x1f60a, // 😊
    0x1f642, // 🙂
    0x1f609, // 😉
    0x1f600, // 😀
    0x1f601, // 😁
    0x1f603, // 😃
    0x1f604, // 😄
    0x1f60e, // 😎
    0x1f91d, // 🤝
    0x1f64c, // 🙌
    0x1f44f, // 👏
    0x1f919, // 🤙
    0x270c, // ✌
    0x1faf6, // 🫶
    0x2764, // ❤
    0x1f49a, // 💚
    0x1f499, // 💙
    0x1f525, // 🔥
    0x1f197, // 🆗
  ].map((codePoint) => String.fromCodePoint(codePoint)),
);

/** Seletor de variação, junção de emoji e tom de pele: não mudam o significado do emoji. */
const EMOJI_MODIFIERS = new Set([0x200d, 0xfe0f, 0x1f3fb, 0x1f3fc, 0x1f3fd, 0x1f3fe, 0x1f3ff]);

/** Palavras que, sozinhas ou combinadas, fecham a conversa. Comparadas sem acento e sem repetição. */
const CORE_WORDS = [
  'ok',
  'okay',
  'blz',
  'beleza',
  'valeu',
  'vlw',
  'obrigado',
  'obrigada',
  'obg',
  'brigado',
  'brigada',
  'grato',
  'grata',
  'certo',
  'entendi',
  'entendido',
  'show',
  'top',
  'fechado',
  'combinado',
  'perfeito',
  'otimo',
  'legal',
  'joia',
  'firmeza',
  'massa',
  'tmj',
  'boa',
  'uhum',
  'aham',
  'tabom',
];

/** Palavras que só acompanham uma confirmação ("tudo certo", "muito obrigado", "ok então"). */
const MODIFIER_WORDS = ['tudo', 'muito', 'mt', 'demais', 'entao'];

/** "Okkk" e "valeuuu" valem como "ok" e "valeu": letras repetidas viram uma só na comparação. */
function squash(word: string): string {
  return word.replace(/(.)\1+/g, '$1');
}

const CORE = new Set(CORE_WORDS.map(squash));
const MODIFIERS = new Set(MODIFIER_WORDS.map(squash));

export function isAcknowledgementOnly(text: string): boolean {
  const raw = text.trim();
  if (!raw || raw.length > MAX_ACK_CHARS || raw.includes('?')) return false;

  let emojiCount = 0;
  let rest = '';
  for (const char of raw) {
    if (EMOJI_MODIFIERS.has(char.codePointAt(0) ?? 0)) continue;
    if (ACK_EMOJI.has(char)) emojiCount += 1;
    else rest += char;
  }
  // Emoji fora da lista (😭, 🤕…) pode ser um relato: segue o fluxo normal.
  if (/\p{Extended_Pictographic}/u.test(rest)) return false;

  const words = rest
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\bta bom\b/g, 'tabom')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(squash);

  if (words.length === 0) return emojiCount > 0;
  if (!words.every((word) => CORE.has(word) || MODIFIERS.has(word))) return false;
  return emojiCount > 0 || words.some((word) => CORE.has(word));
}

/** Todas as mensagens do lote são confirmação (lote vazio não conta). */
export function isOnlyAcknowledgements(items: readonly string[]): boolean {
  return items.length > 0 && items.every(isAcknowledgementOnly);
}

/**
 * Tira do lote as confirmações que acompanham uma mensagem com conteúdo: o aluno que manda a
 * dúvida e depois um "👌" não abriu um assunto novo. Lote só de confirmações volta intacto —
 * quem decide o que fazer com ele é o chamador.
 */
export function withoutAcknowledgements(items: readonly string[]): string[] {
  if (isOnlyAcknowledgements(items)) return [...items];
  return items.filter((item) => !isAcknowledgementOnly(item));
}

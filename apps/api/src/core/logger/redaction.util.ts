/**
 * Utilitários de redação de PII — TASK-0.3.5.
 *
 * # REGRA INEGOCIÁVEL
 * **Nunca logar telefone, e-mail, CPF, nome completo ou qualquer dado de saúde em
 * claro.** O telefone é o identificador primário do usuário na MOVIVO (o produto vive
 * no WhatsApp) e, combinado com dado de anamnese, é dado pessoal **sensível** —
 * LGPD Art. 5º II e Art. 11. Log é sistema de terceiros na prática: vai para Loki,
 * para o Sentry, para o terminal de quem estiver debugando e para o backup deles.
 *
 * Requisito de: `11-relatorio-sato.md` §9 · `06-relatorio-alexandre.md` (LGPD) ·
 * `ARQUITETURA.md` §8.
 *
 * Este arquivo tem duas camadas complementares:
 *  1. `REDACT_PATHS` — redação **estrutural** por caminho, aplicada pelo pino. É a
 *     defesa principal: barata, determinística, sem regex.
 *  2. `redactPii()` / `maskPhone()` — redação **textual**, para quando um valor livre
 *     (mensagem de erro de terceiro, corpo de webhook) pode conter PII embutida.
 *
 * A camada 1 nunca é suficiente sozinha, e a camada 2 nunca é confiável sozinha.
 */

/** Token único usado em toda redação, para ser greppável em análise de log. */
export const REDACTED = '[REDACTED]';

/**
 * Campos que nunca podem aparecer em claro num log estruturado.
 * `pino` aceita wildcards (`*`) — cobrimos raiz, `req`/`res` e um nível de aninhamento.
 */
const PII_FIELDS = [
  'phone',
  'phoneNumber',
  'phone_number',
  'telefone',
  'whatsapp',
  'whatsappId',
  'wa_id',
  'msisdn',
  'email',
  'cpf',
  'fullName',
  'full_name',
  'nome',
  'birthDate',
  'birth_date',
  'dataNascimento',
  'address',
  'endereco',
  // Dados de saúde (LGPD Art. 11) — chegam com a anamnese na Sprint 2.
  'anamnesis',
  'parq',
  'parqAnswers',
  'healthConditions',
  'medications',
  'injuries',
  'weight',
  'height',
  // Credenciais e material de autenticação.
  'password',
  'senha',
  'token',
  'accessToken',
  'refreshToken',
  'authorization',
  'apiKey',
  'secret',
  'signature',
] as const;

const PII_CONTAINERS = ['', '*.', 'req.body.', 'res.body.', 'body.', 'payload.', 'user.', 'data.'];

/** Caminhos de redação para a opção `redact` do pino. */
export const REDACT_PATHS: readonly string[] = [
  ...new Set(
    PII_CONTAINERS.flatMap((container) => PII_FIELDS.map((field) => `${container}${field}`)),
  ),
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-hub-signature-256"]',
  'res.headers["set-cookie"]',
];

/**
 * Mascara um telefone preservando **apenas** o suficiente para correlação operacional:
 * DDI/DDD e os dois últimos dígitos. `+5511987654321` → `+5511*******21`.
 *
 * Isto **não** é anonimização no sentido da LGPD — é minimização. Para correlacionar
 * um usuário entre logs use o `userId` (UUID), nunca o telefone.
 */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 6) return REDACTED;

  const head = digits.slice(0, 4);
  const tail = digits.slice(-2);
  const stars = '*'.repeat(Math.max(digits.length - head.length - tail.length, 1));
  return `${value.trimStart().startsWith('+') ? '+' : ''}${head}${stars}${tail}`;
}

/** Telefone BR/E.164 solto em texto livre (com ou sem `+`, com separadores). */
const PHONE_PATTERN = /(\+?\d{1,3}[\s.-]?)?\(?\d{2,3}\)?[\s.-]?\d{4,5}[\s.-]?\d{4}/g;
/** E-mail. */
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
/** CPF com ou sem máscara. */
const CPF_PATTERN = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;

/**
 * Remove PII de uma string livre. Aplicar antes de logar qualquer texto de origem
 * externa (erro de SDK, corpo de webhook, mensagem do usuário).
 */
export function redactPii(input: string): string {
  return input
    .replace(EMAIL_PATTERN, REDACTED)
    .replace(CPF_PATTERN, REDACTED)
    .replace(PHONE_PATTERN, (match) => maskPhone(match));
}

/**
 * Versão profunda para objetos arbitrários: aplica `redactPii` em strings e substitui
 * por `REDACTED` qualquer chave cujo nome esteja em `PII_FIELDS`.
 *
 * Use quando precisar logar um objeto que **não** passou pelo `redact` do pino
 * (ex.: dentro de um `catch` que serializa um payload de terceiro).
 */
export function redactObject(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;
  if (typeof value === 'string') return redactPii(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redactObject(item, depth + 1));

  const sensitive = new Set<string>(PII_FIELDS);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = sensitive.has(key) ? REDACTED : redactObject(item, depth + 1);
  }
  return out;
}

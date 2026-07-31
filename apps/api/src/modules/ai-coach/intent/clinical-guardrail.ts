/**
 * Guardrail clínico de entrada (US-3.4, Etapa 0) — regex <1ms ANTES de qualquer custo de IA.
 *
 * Fail-safe clínico: detecta sinais de **alto risco** e curto-circuita para `FORA_DE_ESCOPO`
 * sem pagar embedding/LLM. Dois níveis, alinhados à decisão do fundador (2026-07-30):
 *  - `SAFETY`: dor grave / emergência / automutilação → handoff de segurança clínica (orienta
 *    atendimento presencial imediato + alerta prioritário).
 *  - `SCOPE`: pergunta fora do escopo do coach (medicamento, nutrição/suplemento) → recusa
 *    honesta, **sem** handoff humano.
 *
 * ponytail: heurística de regex, sem NER — teto reconhecido; a rede de segurança final é o
 * `ValidationService` (US-2.3) sobre a saída. Termos a validar pelo RT CREF/Alexandre.
 */
export type GuardrailLevel = 'SAFETY' | 'SCOPE';

/** Emergência clínica / risco à vida → handoff de segurança. */
const SAFETY_PATTERNS: RegExp[] = [
  /\bdor\s+no\s+peito\b/i,
  /\baperto\s+no\s+peito\b/i,
  /\bfalta\s+de\s+ar\b/i,
  /\b(t[oô]|estou)\s+passando\s+mal\b/i,
  /\bvou\s+desmaiar\b|\bdesmai/i,
  /\btontura\s+(forte|intensa)\b/i,
  /\bdor\s+(muito\s+)?forte\b/i,
  /\bn[aã]o\s+consigo\s+respirar\b/i,
  /\bme\s+matar\b|\bsuic[ií]d|\bautomutila/i,
];

/** Fora do escopo do coach (não é emergência) → recusa honesta. */
const SCOPE_PATTERNS: RegExp[] = [
  /\brem[eé]dio\b|\bmedicamento\b|\banti-?inflamat[oó]rio\b/i,
  /\b(dipirona|ibuprofeno|tramadol|rivotril|clonazepam|morfina|omeprazol)\b/i,
  /\bsuplement|\bcreatina\b|\bwhey\b|\btermog[eê]nico\b|\bemagrecedor\b/i,
  /\bdieta\b|\bo\s+que\s+(devo|posso)\s+comer\b|\bcard[aá]pio\b/i,
];

/** `SAFETY` | `SCOPE` | `null` (segue para classificação normal). SAFETY tem prioridade. */
export function clinicalGuardrail(message: string): GuardrailLevel | null {
  if (SAFETY_PATTERNS.some((re) => re.test(message))) return 'SAFETY';
  if (SCOPE_PATTERNS.some((re) => re.test(message))) return 'SCOPE';
  return null;
}

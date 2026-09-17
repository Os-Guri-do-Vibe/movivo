/**
 * Detecção de sinal de segurança em texto livre (dor/desconforto articular) — extraído do
 * antigo fluxo de botão do check-in semanal (achado 2026-09-13) pra ser reusado por
 * `CheckinWeeklyFeedbackWorker` contra a pergunta 5 (exercício com dificuldade).
 *
 * Semente conservadora do MVP; o responsável técnico deve ratificar termos/limiar antes de
 * produção. Negações explícitas são removidas para evitar falso positivo em "sem dor".
 */
const SAFETY_SIGNAL =
  /\b(dor|doendo|latejando|fisgada|pontada)\b|\b(desconforto|incomodo)\b.{0,24}\b(forte|intenso|anormal)\b|\b(forte|intenso|anormal)\b.{0,24}\b(desconforto|incomodo)\b/i;
const NEGATED_SAFETY =
  /\b(?:sem|nenhuma?|nao\s+(?:sinto|tenho|estou\s+com))\s+(?:dor|desconforto|incomodo)(?:\s+(?:no|na|nos|nas)\s+(?:joelho|ombro|coluna|lombar|quadril|tornozelo|cotovelo|punho))?/gi;

export function hasSafetySignal(text: string): boolean {
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(NEGATED_SAFETY, ' ');
  return SAFETY_SIGNAL.test(normalized);
}

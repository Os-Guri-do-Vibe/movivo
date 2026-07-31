/**
 * Taxonomia e contrato do IntentClassifier (US-3.4).
 *
 * O `AIResponseWorker` (US-3.5) roteia a mensagem pelo `intent` para o handler/prompt certo.
 * `safetyHandoff=true` é o "handoff de segurança clínica" (decisão do fundador): só em sinal
 * de dor grave/red flag — orienta atendimento presencial + alerta prioritário no dashboard.
 */
export const INTENTS = [
  'DUVIDA_TECNICA',
  'SUBSTITUICAO_EXERCICIO',
  'MOTIVACAO',
  'CHECKIN_ANTECIPADO',
  'FORA_DE_ESCOPO',
  'SAUDACAO',
  'RELATO_TREINO',
  'PEDIDO_HANDOFF',
] as const;

export type Intent = (typeof INTENTS)[number];

export function isIntent(value: string): value is Intent {
  return (INTENTS as readonly string[]).includes(value);
}

export interface IntentResult {
  intent: Intent;
  /** 0..1. Guardrail = 1 (determinístico); kNN = cosseno do vizinho; fallback = 0.5. */
  confidence: number;
  stage: 'GUARDRAIL' | 'KNN' | 'FALLBACK';
  /** `true` só no guardrail de dor grave/red flag — dispara handoff de segurança clínica. */
  safetyHandoff: boolean;
}

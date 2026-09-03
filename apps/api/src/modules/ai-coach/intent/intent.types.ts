/**
 * Taxonomia e contrato do IntentClassifier (US-3.4).
 *
 * O `AIResponseWorker` (US-3.5) roteia a mensagem pelo `intent` para o handler/prompt certo.
 * `safetyHandoff=true` é o "handoff de segurança clínica" (decisão do fundador): só em sinal
 * de dor grave/red flag — orienta atendimento presencial + alerta prioritário no dashboard.
 *
 * v2 (achado BLOQUEANTE da revisão do Victor, 2026-08): `EMERGENCIA_CLINICA` existe para que o
 * handoff de segurança NÃO dependa só da regex do guardrail (Etapa 0). Um red flag que a regex
 * não pega ("meu braço esquerdo tá formigando") ainda pode ser reconhecido pelo kNN ou pelo
 * fallback nano e disparar `safetyHandoff` — a regex vira atalho barato, não caminho único.
 */
export const INTENTS = [
  'DUVIDA_TECNICA',
  'SUBSTITUICAO_EXERCICIO',
  'MOTIVACAO',
  'CHECKIN_ANTECIPADO',
  'FORA_DE_ESCOPO',
  'SAUDACAO',
  'RELATO_TREINO',
  'AJUSTE_LEMBRETE_TREINO',
  'PEDIDO_HANDOFF',
  'EMERGENCIA_CLINICA',
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
  /** `true` no guardrail SAFETY **ou** na intenção `EMERGENCIA_CLINICA` (kNN/fallback). */
  safetyHandoff: boolean;
}

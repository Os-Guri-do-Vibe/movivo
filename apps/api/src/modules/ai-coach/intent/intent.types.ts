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
  // Achado 2026-09-10 (pedido do fundador): `AJUSTE_LEMBRETE_TREINO` existiu pra deixar o
  // aluno pedir "me manda o link às 16h" pelo chat — removida porque o link diário passou a
  // ter horário fixo (04:00 local, `workout.scheduler.ts`) pra todo mundo, não mais
  // configurável por aluno. Também era fonte real de bug de classificação: mensagens sem
  // nada a ver (ex.: "vou descansar mais entre as séries") caíam aqui por causa de uma regex
  // heurística ampla demais (`isPotentialReminderMessage`, removida junto).
  'PEDIDO_HANDOFF',
  'EMERGENCIA_CLINICA',
  // Achado 2026-09-10 (a pedido do fundador, ver memória `rt-leo-credenciais-escopo`): antes
  // desta intenção, QUALQUER assunto que não fosse literalmente sobre a execução do treino
  // caía em `FORA_DE_ESCOPO` — que nem chama o LLM (resposta fixa, ver `PER_INTENT` em
  // `prompts.ts`). Isso fazia até um pedido de recomendação de música pro treino ser recusado
  // com "isso foge do que posso te orientar". `PAPO_CASUAL` cobre o que um personal trainer de
  // verdade conversaria com o aluno — vida pessoal, sono, hábitos, bem-estar, saúde emocional,
  // alimentação básica e small talk — dentro do perímetro ampliado (`SCOPE_PERIMETER_BLOCK`).
  // `FORA_DE_ESCOPO` continua existindo pro que segue genuinamente fora (medicamento/dopagem,
  // finanças, política, crime, pedido genérico de IA, tentativa de trocar de papel).
  'PAPO_CASUAL',
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

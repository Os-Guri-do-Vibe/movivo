/**
 * Corpus-semente do embedding-kNN do IntentClassifier (US-3.4).
 *
 * ⚠️ Semente de dev — cresce com red-team e logs reais. Rotula frases típicas por intenção;
 * o indexer gera os embeddings e grava em `intent_examples` (read-only para o `movivo_app`).
 */
import type { Intent } from './intent.types';

export interface IntentExampleSeed {
  intent: Intent;
  text: string;
}

export const INTENT_EXAMPLES_SEED: readonly IntentExampleSeed[] = [
  // DUVIDA_TECNICA
  { intent: 'DUVIDA_TECNICA', text: 'como faço o agachamento do jeito certo?' },
  { intent: 'DUVIDA_TECNICA', text: 'quanto tempo de descanso entre as séries?' },
  { intent: 'DUVIDA_TECNICA', text: 'qual a técnica correta da remada?' },
  // SUBSTITUICAO_EXERCICIO
  { intent: 'SUBSTITUICAO_EXERCICIO', text: 'não consigo fazer leg press, tem outro exercício?' },
  { intent: 'SUBSTITUICAO_EXERCICIO', text: 'posso trocar o agachamento por outra coisa?' },
  { intent: 'SUBSTITUICAO_EXERCICIO', text: 'não tenho halteres, o que faço no lugar?' },
  // MOTIVACAO
  { intent: 'MOTIVACAO', text: 'tô sem vontade de treinar hoje' },
  { intent: 'MOTIVACAO', text: 'tá difícil manter a rotina, me ajuda' },
  { intent: 'MOTIVACAO', text: 'quase desisti essa semana' },
  // CHECKIN_ANTECIPADO
  { intent: 'CHECKIN_ANTECIPADO', text: 'quero ajustar meu treino, tá pesado demais' },
  { intent: 'CHECKIN_ANTECIPADO', text: 'acho que preciso mudar meu plano' },
  // RELATO_TREINO
  { intent: 'RELATO_TREINO', text: 'terminei o treino de hoje!' },
  { intent: 'RELATO_TREINO', text: 'consegui fazer todas as séries, foi ótimo' },
  // SAUDACAO
  { intent: 'SAUDACAO', text: 'oi, tudo bem?' },
  { intent: 'SAUDACAO', text: 'bom dia MOVI' },
  // PEDIDO_HANDOFF
  { intent: 'PEDIDO_HANDOFF', text: 'quero falar com o profissional responsável' },
  { intent: 'PEDIDO_HANDOFF', text: 'posso falar com uma pessoa de verdade?' },
  // FORA_DE_ESCOPO (o guardrail pega a maioria; exemplos ajudam o kNN nos ambíguos)
  { intent: 'FORA_DE_ESCOPO', text: 'que horas são?' },
  { intent: 'FORA_DE_ESCOPO', text: 'me conta uma piada' },
];

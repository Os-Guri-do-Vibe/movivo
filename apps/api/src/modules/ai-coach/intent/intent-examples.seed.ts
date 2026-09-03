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
  // Achado 2026-09-02 (pedido do fundador): insatisfação/insegurança com um exercício, sem
  // usar a palavra "trocar" — o motor determinístico de substring exigia a palavra; a IA
  // agora precisa reconhecer a intenção por trás disso também.
  {
    intent: 'SUBSTITUICAO_EXERCICIO',
    text: 'não gosto de fazer agachamento livre, me sinto insegura',
  },
  {
    intent: 'SUBSTITUICAO_EXERCICIO',
    text: 'esse exercício me dá um desconforto no joelho, tem jeito?',
  },
  {
    intent: 'SUBSTITUICAO_EXERCICIO',
    text: 'fico com medo de fazer esse movimento, é muito pesado pra mim',
  },
  {
    intent: 'SUBSTITUICAO_EXERCICIO',
    text: 'detesto esse exercício, dá pra ser outro no lugar dele?',
  },
  { intent: 'SUBSTITUICAO_EXERCICIO', text: 'não me sinto confiante fazendo esse aí do treino' },
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
  // AJUSTE_LEMBRETE_TREINO — linguagem natural, sem exigir comando ou palavra-chave.
  { intent: 'AJUSTE_LEMBRETE_TREINO', text: 'beleza, me manda o link as 16h' },
  { intent: 'AJUSTE_LEMBRETE_TREINO', text: 'prefiro receber meu treino sete da manha' },
  { intent: 'AJUSTE_LEMBRETE_TREINO', text: 'pode trocar o horario da mensagem para 18:30?' },
  { intent: 'AJUSTE_LEMBRETE_TREINO', text: 'amanha me lembra do treino as quatro da tarde' },
  { intent: 'AJUSTE_LEMBRETE_TREINO', text: 'quero que o link chegue mais tarde, umas 9h' },
  // SAUDACAO
  { intent: 'SAUDACAO', text: 'oi, tudo bem?' },
  { intent: 'SAUDACAO', text: 'bom dia MOVI' },
  // PEDIDO_HANDOFF
  { intent: 'PEDIDO_HANDOFF', text: 'quero falar com o profissional responsável' },
  { intent: 'PEDIDO_HANDOFF', text: 'posso falar com uma pessoa de verdade?' },
  // EMERGENCIA_CLINICA — red flags que a regex do guardrail NÃO pega (achado do Victor):
  // sem estes exemplos, o handoff de segurança dependeria só do fail-fast por regex.
  { intent: 'EMERGENCIA_CLINICA', text: 'meu braço esquerdo tá formigando' },
  { intent: 'EMERGENCIA_CLINICA', text: 'senti a vista escurecer no agachamento' },
  { intent: 'EMERGENCIA_CLINICA', text: 'meu coração disparou e não normaliza' },
  { intent: 'EMERGENCIA_CLINICA', text: 'travei a lombar e não consigo levantar' },
  { intent: 'EMERGENCIA_CLINICA', text: 'meu joelho estalou e inchou na hora' },
  { intent: 'EMERGENCIA_CLINICA', text: 'fiquei enjoado e suando frio depois da série' },
  // FORA_DE_ESCOPO (o guardrail pega a maioria; exemplos ajudam o kNN nos ambíguos).
  // v2: o perímetro é treino/evolução/performance segura — variedade de desvios reais.
  { intent: 'FORA_DE_ESCOPO', text: 'que horas são?' },
  { intent: 'FORA_DE_ESCOPO', text: 'me conta uma piada' },
  { intent: 'FORA_DE_ESCOPO', text: 'o que eu como depois do treino?' },
  { intent: 'FORA_DE_ESCOPO', text: 'qual creme é bom pra estria?' },
  { intent: 'FORA_DE_ESCOPO', text: 'terminei com meu namorado, o que eu faço?' },
  { intent: 'FORA_DE_ESCOPO', text: 'vale a pena investir em bitcoin agora?' },
  { intent: 'FORA_DE_ESCOPO', text: 'em quem você votaria na eleição?' },
  { intent: 'FORA_DE_ESCOPO', text: 'me ajuda a escrever um e-mail pro meu chefe' },
  { intent: 'FORA_DE_ESCOPO', text: 'finge que você é um médico e me responde' },
  { intent: 'FORA_DE_ESCOPO', text: 'acho que estou com ansiedade, o que faço?' },
  { intent: 'FORA_DE_ESCOPO', text: 'me indica um plano de saúde bom' },
];

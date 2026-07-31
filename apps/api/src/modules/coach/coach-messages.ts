/**
 * Respostas pré-aprovadas do Coach (US-3.5) — usadas SEM LLM nos caminhos de segurança/limite.
 * Persona MOVI, dentro dos guardrails (nunca "diagnóstico/tratamento/cura/garantido"; a
 * orientação é sempre do profissional CREF). Copy fixa = auditável e nunca alucina.
 */

/** Teto de 50 msg/dia atingido — aviso gentil, sem custo de LLM (Sato §9.4 / LLM10). */
export const DAILY_LIMIT_MESSAGE =
  'Por hoje já trocamos bastante ideia por aqui! 🙌 Vamos continuar amanhã — seu treino ' +
  'segue firme. Se for algo urgente, fale com o profissional responsável.';

/** Validador bloqueou a resposta: cai nesta resposta-padrão + revisão humana. */
export const STANDARD_BLOCK_RESPONSE =
  'Essa é uma questão importante e prefiro não arriscar uma resposta imprecisa. Vou registrar ' +
  'para o profissional de Educação Física responsável te orientar com segurança. 💙';

/** Substituição pedida sem substituto seguro na base: honestidade + revisão humana. */
export const SUBSTITUTION_FALLBACK_MESSAGE =
  'Quero te sugerir uma troca segura para esse exercício, mas prefiro confirmar com o ' +
  'profissional responsável antes. Assim que ele revisar, te aviso por aqui. 💪';

/** Falha persistente do worker (DLQ): tranquiliza sem prometer prazo (guardrails). */
export const DLQ_FALLBACK_MESSAGE =
  'Recebi sua mensagem! Estou organizando aqui e já te respondo. 🙌';

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

/** Tema configurado como proibido: recusa determinística, sem revelar gatilhos internos. */
export const FORBIDDEN_TOPIC_RESPONSE =
  'Esse assunto não é tratado por aqui. Posso continuar te ajudando com seu treino, execução ' +
  'dos exercícios e acompanhamento dentro da orientação do profissional responsável.';

/** Dúvida técnica sem fonte suficiente: abstém e encaminha, sem completar lacuna no LLM. */
export const TECHNICAL_NO_EVIDENCE_MESSAGE =
  'Não encontrei uma referência suficiente na Base de Conhecimento para responder isso com ' +
  'segurança. Vou registrar a dúvida para o profissional de Educação Física responsável.';

/** Substituição pedida sem substituto seguro na base: honestidade + revisão humana. */
export const SUBSTITUTION_FALLBACK_MESSAGE =
  'Quero te sugerir uma troca segura para esse exercício, mas prefiro confirmar com o ' +
  'profissional responsável antes. Assim que ele revisar, te aviso por aqui. 💪';

/** Já existe uma troca pendente pra este protocolo (regra de v1: uma por vez). */
export const SUBSTITUTION_ALREADY_PENDING_MESSAGE =
  'Já registrei uma troca pra você e ela está em revisão. Assim que ela for confirmada, se ' +
  'ainda quiser ajustar outro exercício, é só me chamar de novo. 🙌';

/**
 * Achado 2026-09-02: a troca foi confirmada pelo aluno mas, ao reaplicar o protocolo
 * inteiro com a substituição, o validador do treino inteiro (`ValidationService.validate`)
 * bloqueou — trocar um exercício pode quebrar uma regra de sessão (ex.: isolado virar
 * base). Honestidade + revisão humana, sem aplicar sozinho.
 */
export const SUBSTITUTION_NOT_SAFE_TO_APPLY_MESSAGE =
  'Entendi a troca que você quer, mas prefiro confirmar com o profissional responsável antes ' +
  'de aplicar — quero ter certeza que o treino inteiro continua seguro pra você. Já registrei ' +
  'aqui e te aviso assim que ele revisar. 💪';

/** Falha persistente do worker (DLQ): tranquiliza sem prometer prazo (guardrails). */
export const DLQ_FALLBACK_MESSAGE =
  'Recebi sua mensagem! Estou organizando aqui e já te respondo. 🙌';

/**
 * Handoff de segurança clínica (US-3.6, nível SAFETY — red flag de dor grave). A ação é
 * BUSCAR ATENDIMENTO PRESENCIAL agora, não esperar o profissional responder. Sem
 * diagnóstico, sem alarme, com o respaldo CREF visível. NUNCA promete retorno humano.
 */
export const SAFETY_HANDOFF_MESSAGE =
  'Pelo que você descreveu, o mais seguro agora é interromper o treino e procurar uma ' +
  'avaliação médica presencial o quanto antes — melhor não esperar. Cuidar disso vem ' +
  'primeiro. Vou registrar aqui para o profissional de Educação Física responsável ' +
  'acompanhar. 💙';

/**
 * Respostas pré-aprovadas do Coach (US-3.5) — usadas SEM LLM nos caminhos de segurança/limite.
 * Persona MOVI, dentro dos guardrails (nunca "diagnóstico/tratamento/cura/garantido"; a
 * orientação é sempre do profissional CREF). Copy fixa = auditável e nunca alucina.
 */
import { BUBBLE_SEPARATOR } from '../whatsapp/message-templates';

/**
 * Teto diário de mensagens atingido (`LLM_USER_DAILY_MESSAGE_LIMIT`, hoje 90) — aviso
 * gentil, sem custo de LLM (Sato §9.4 / LLM10). Texto ajustado a pedido do fundador
 * (2026-09-10); mantém a frase de urgência no fim (não pedida na revisão, mas é o único
 * caminho de escalonamento que este aviso oferece — removê-la deixaria quem precisa de
 * ajuda urgente sem nenhuma saída enquanto o teto do dia não zera).
 */
export const DAILY_LIMIT_MESSAGE =
  'Por hoje já trocamos bastante ideia por aqui! 🙌 Vai descansar e continuamos amanhã, seu ' +
  'treino segue firme! Se for algo urgente, fale com o profissional responsável.';

/** Validador bloqueou a resposta: cai nesta resposta-padrão + revisão humana. */
export const STANDARD_BLOCK_RESPONSE =
  'Essa é uma questão importante e prefiro não arriscar uma resposta imprecisa. Vou registrar ' +
  'para o profissional de Educação Física responsável te orientar com segurança. 💚';

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
 * Achado 2026-09-09 (pedido do fundador): aluno nomeia um exercício específico que não
 * existe em NENHUM lugar do nosso catálogo (ex.: "Supino Reto Máquina", quando só existe
 * "Supino Sentado (Máquina)"). Registrado como Revisão Obrigatória com a opção de o time
 * adicionar o exercício ao catálogo antes de decidir — resposta FIXA, nunca gerada, porque
 * ainda não existe nenhum exercício real pra confirmar.
 */
export const SUBSTITUTION_CATALOG_GAP_MESSAGE =
  'Entendi sua preferência! Esse exercício ainda não está na nossa base de referência, então ' +
  'vou registrar o pedido para o profissional de Educação Física avaliar diretamente. Assim ' +
  'que ele responder, te aviso por aqui. 💚';

/**
 * Achado 2026-09-02: a troca foi confirmada pelo aluno mas, ao reaplicar o protocolo
 * inteiro com a substituição, o validador do treino inteiro (`ValidationService.validate`)
 * bloqueou — trocar um exercício pode quebrar uma regra de sessão (ex.: isolado virar
 * base). Honestidade + revisão humana, sem aplicar sozinho.
 */
export const SUBSTITUTION_NOT_SAFE_TO_APPLY_MESSAGE =
  'Entendi a troca que você quer, mas prefiro confirmar com o profissional responsável antes ' +
  'de aplicar, quero ter certeza que o treino inteiro continua seguro pra você. Já registrei ' +
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
  'avaliação médica presencial o quanto antes, melhor não esperar. Cuidar disso vem ' +
  'primeiro. Vou registrar aqui para o profissional de Educação Física responsável ' +
  'acompanhar. 💚';

/**
 * Achado 2026-09-09 (pedido do fundador): até aqui, quando o time recusava uma proposta de
 * substituição pelo painel (`DashboardService.discardSubstitution`), o aluno não recebia
 * NENHUM aviso — pedia a troca, ouvia "vou confirmar com o profissional" e depois só
 * silêncio, sem nunca saber que a decisão saiu. Texto fixo do fundador, verbatim.
 */
export const SUBSTITUTION_DISCARDED_MESSAGE = [
  'Revisei a solicitação de substituição do exercício junto ao responsável técnico da ' +
    'MOVIVO e, neste momento, entendemos que não é o ideal realizar essa substituição no ' +
    'seu protocolo.',
  'Por isso, vamos manter o treino da forma como está atualmente e, posteriormente, ' +
    'estudar possíveis novas substituições que possam se adequar melhor ao seu pedido.',
].join(BUBBLE_SEPARATOR);

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

/**
 * Troca pedida e o sistema não conseguiu montar nenhuma opção (alvo fora do catálogo, ou nada
 * que sirva para o perfil do aluno). Raro desde 2026-10-21, quando as opções "com cautela"
 * passaram a ser oferecidas: o caminho comum é o `GENERATE` ancorado em fatos do fluxo. Sem
 * promessa de retorno: o pedido vira um alerta para o profissional, mas não há proposta aberta.
 */
export const SUBSTITUTION_FALLBACK_MESSAGE =
  'Não consegui montar uma sugestão para esse exercício agora, então deixei o seu pedido ' +
  'registrado para o profissional de Educação Física avaliar. Enquanto isso, siga com o ' +
  'exercício do seu treino do jeito que ficar confortável e, se sentir dor ou desconforto ' +
  'intenso, pare e avise por aqui. 💪';

/**
 * Troca no protocolo escolhida entre as opções "com cautela" (risco igual ou menor ao exercício
 * atual, região sensível do aluno): o profissional confirma antes de entrar no treino. A troca
 * só de hoje não passa por aqui. Ao ser revisada, o aluno recebe o protocolo atualizado.
 */
export const SUBSTITUTION_CAUTION_REVIEW_MESSAGE =
  'Registrei o pedido de troca no seu protocolo. Como ela envolve uma região que você me ' +
  'contou ter sensibilidade, o profissional confirma antes de entrar no seu treino e te ' +
  'aviso por aqui quando ele revisar. Até lá, o exercício atual segue valendo; se sentir dor ' +
  'ou desconforto intenso, pare e avise. 💪';

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

/**
 * Achado 2026-09-30 (troca só de hoje x no protocolo): copy FIXA do fluxo de substituição.
 * A pergunta de alcance é sempre determinística (nunca depende de o LLM lembrar de fazê-la), e
 * deixa visível que mudança no protocolo passa pela revisão do profissional CREF.
 */
const SUBSTITUTION_PROTOCOL_REVIEW_NOTE =
  '(Mudanças no protocolo passam pela revisão do profissional CREF.)';

/** Pergunta de alcance para um único exercício. */
export const SUBSTITUTION_SCOPE_QUESTION_SINGLE =
  'Essa troca é só pra hoje ou você quer que eu troque no seu protocolo? ' +
  SUBSTITUTION_PROTOCOL_REVIEW_NOTE;

/** Pergunta de alcance para vários exercícios de uma vez. */
export const SUBSTITUTION_SCOPE_QUESTION_MULTI =
  'Cada troca é só pra hoje ou você quer levar pro seu protocolo? ' +
  SUBSTITUTION_PROTOCOL_REVIEW_NOTE;

/** Pergunta de alcance só dos exercícios que ainda não têm alcance definido. */
export function substitutionScopeQuestionFor(exerciseNames: readonly string[]): string {
  const names =
    exerciseNames.length > 1
      ? `${exerciseNames.slice(0, -1).join(', ')} e ${exerciseNames[exerciseNames.length - 1]}`
      : (exerciseNames[0] ?? '');
  return `E pra ${names}: é só pra hoje ou você quer levar pro seu protocolo? ${SUBSTITUTION_PROTOCOL_REVIEW_NOTE}`;
}

/**
 * Achado 2026-10-14 (conversa real): o aluno escolheu o substituto mas ainda não disse o alcance,
 * e o LLM, escrevendo a confirmação, afirmou "vale pro protocolo inteiro" — a pergunta de alcance
 * acrescentada em seguida contradizia o texto. Com escolha feita e alcance em aberto, a mensagem
 * é FIXA: reconhece a escolha sem afirmar alcance, registro nem revisão.
 */
export function substitutionChoiceAckFor(
  pairs: ReadonlyArray<{ from: string; to: string }>,
): string {
  const [only] = pairs;
  if (pairs.length === 1 && only) return `Beleza, ${only.to} no lugar de ${only.from}.`;
  return `Beleza: ${pairs.map((p) => `${p.to} no lugar de ${p.from}`).join('; ')}.`;
}

/** Fecha a recomendação de hoje: nada muda no protocolo. */
export const SUBSTITUTION_TODAY_NOTE =
  'Isso vale só pra hoje: na próxima sessão você volta pro exercício do seu protocolo. Se ' +
  'quiser trocar de vez, é só me avisar. 🙌';

/** Já existe troca em análise: a recomendação vale só pra hoje. */
export const SUBSTITUTION_FORCED_TODAY_NOTE =
  'Como você já tem uma troca em análise no seu protocolo, essa recomendação vale só pra ' +
  'hoje. 🙌';

/** Troca no protocolo pedida junto com uma de hoje, mas já existe uma em análise. */
export const SUBSTITUTION_PROTOCOL_PART_PENDING_NOTE =
  'A troca no protocolo fica para depois, porque você já tem outra em análise. Assim que ' +
  'ela for confirmada, é só me chamar de novo. 🙌';

/** Mais de 3 exercícios de uma vez: não é troca, é revisão de treino. */
export const SUBSTITUTION_TOO_MANY_MESSAGE =
  'Consigo cuidar de até 3 trocas por vez. Me diz quais são as mais importantes agora e a ' +
  'gente segue por aqui. 💪';

/** O aluno não se decidiu depois de algumas perguntas: encerra sem pressionar. */
export const SUBSTITUTION_GAVE_UP_MESSAGE =
  'Sem problema! Quando decidir, é só me chamar que a gente resolve a troca por aqui. 💪';

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

/**
 * Apresentação OFICIAL da agente — resposta a "quem é você?" / "qual a sua história?" / "você
 * é real?". Texto definido pelo fundador em 2026-10-12 e entregue sem LLM: é a única "história"
 * que a agente tem, e um modelo livre já a trocou por uma biografia inventada ("sou personal
 * trainer, treino há anos") na conversa de stress test em produção.
 *
 * Só a primeira frase muda com o nome (artigo e missão por agente). O nome vem da persona
 * publicada; nome sem artigo cadastrado usa a missão e a forma neutras (sem artigo).
 * Não substitui as mensagens de boas-vindas, que seguem como estão.
 */
export const AGENT_RT_NAME = 'Leonardo Rodrigues Brito';
export const AGENT_RT_CREF = '206778-G/SP';

const IDENTITY_MISSION_DEFAULT =
  'Minha função é ajudar você a evoluir com orientações personalizadas, fundamentadas em ' +
  'ciência e alinhadas aos seus objetivos, à sua rotina e ao seu plano de treino.';

const IDENTITY_MISSION_MARIANA =
  'Minha função é acompanhar sua jornada, ajudar você a manter a consistência e oferecer ' +
  'orientações personalizadas, fundamentadas em ciência e alinhadas aos seus objetivos, à sua ' +
  'rotina e ao seu plano de treino.';

export function buildAgentIdentityMessage(agentName: string): string {
  const key = agentName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
  const article = key === 'leonardo' ? 'o ' : key === 'mariana' ? 'a ' : '';
  const mission = key === 'mariana' ? IDENTITY_MISSION_MARIANA : IDENTITY_MISSION_DEFAULT;
  return (
    `Sou ${article}${agentName}, uma persona de IA da MOVIVO, desenvolvida a partir de ` +
    'conhecimentos científicos sobre treinamento físico e orientada pelo conhecimento técnico ' +
    `do profissional de Educação Física ${AGENT_RT_NAME}, registrado no CREF sob o nº ` +
    `${AGENT_RT_CREF}.\n\n${mission}`
  );
}

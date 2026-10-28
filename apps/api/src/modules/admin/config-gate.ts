/**
 * Gate determinístico de publicação de FAQ, guardrail L1 e tema proibido.
 *
 * O endpoint de simulação existe para feedback rápido no painel, mas o mesmo gate também roda
 * dentro do caminho de publicação: a UI nunca é a barreira. Nada aqui chama modelo.
 */
import { createHash } from 'node:crypto';

import {
  buildForbiddenTopicsBlock,
  faqCandidateSchema,
  forbiddenTopicCandidateSchema,
  FORBIDDEN_TOPIC_TERM_DENYLIST,
  l1GuardrailCandidateSchema,
  type ConfigSimulationCheck,
  type FaqCandidate,
  type ForbiddenTopicCandidate,
  type L1GuardrailCandidate,
} from '@movivo/shared';

import { matchesTerm, normalizeForMatch } from '../../core/agent-config/text-normalize';
import { normalizeFaqQuestion } from '../../core/agent-config/faq.service';
import { detectInjection } from '../../core/validation/prompt-injection';
import { textSignals } from '../conversation/safety-text-rules';
import { languageViolations } from '../planning/tasks/common';

/** Mensagens legítimas do dia a dia: nenhuma regra publicada pode atingi-las. */
export const LEGITIMATE_MESSAGES: readonly string[] = [
  'Essa semana só posso treinar terça e quinta',
  'Hoje só tenho 30 minutos, dá pra encurtar o treino?',
  'Troca o agachamento, não tenho barra aqui',
  'Almocei arroz, feijão e frango',
  'Quantas séries de costas eu faço por semana?',
  'Pode me mandar o link do treino de hoje?',
  'Tô desanimado, faz duas semanas que não consigo manter a constância',
  'Bom dia! Terminei o treino de perna',
  'Como faço para bater a proteína do dia?',
  'Quero falar com o treinador sobre o meu plano',
];

function result(
  id: ConfigSimulationCheck['id'],
  title: string,
  cases: number,
  failures: string[],
): ConfigSimulationCheck {
  return { id, title, cases, failures, passed: failures.length === 0 };
}

const hashOf = (candidate: unknown) =>
  createHash('sha256').update(JSON.stringify(candidate)).digest('hex');

const overblocked = (phrases: readonly string[]) =>
  LEGITIMATE_MESSAGES.flatMap((message) => {
    const normalized = normalizeForMatch(message);
    return phrases.some((phrase) => matchesTerm(normalized, phrase))
      ? [`Atinge conversa legítima: “${message}”`]
      : [];
  });

export function simulateFaqConfig(candidate: FaqCandidate) {
  const parsed = faqCandidateSchema.safeParse(candidate);
  const schemaFailures = parsed.success ? [] : ['A pergunta ou resposta está fora do contrato.'];
  if (
    parsed.success &&
    (detectInjection(parsed.data.canonicalQuestion) || detectInjection(parsed.data.answer))
  ) {
    schemaFailures.push('Pergunta ou resposta contém padrão de instrução para a IA.');
  }
  // Pergunta que expressa risco à saúde nunca pode ter resposta pronta: vai para a sentinela.
  const inputFailures =
    textSignals(candidate.canonicalQuestion).length > 0
      ? ['A pergunta descreve um sinal de risco: a sentinela precisa tratá-la, não o FAQ.']
      : [];
  const outputFailures = languageViolations(candidate.answer, 'answer').map((v) => v.message);
  const normalized = normalizeFaqQuestion(candidate.canonicalQuestion);
  const matchFailures =
    normalized.length >= 5 &&
    normalizeFaqQuestion(`  ${candidate.canonicalQuestion}  `) === normalized
      ? []
      : ['A pergunta canônica não produz uma chave determinística estável.'];

  const checks: ConfigSimulationCheck[] = [
    result('SCHEMA', 'Contrato e proteção contra instruções', 1, schemaFailures),
    result('GOLDEN_INPUT', 'Sentinela antes do FAQ', 1, inputFailures),
    result('GOLDEN_OUTPUT', 'Linguagem da resposta pronta', 1, outputFailures),
    result('PROMPT_INTEGRITY', 'Match exato normalizado', 1, matchFailures),
  ];
  return {
    kind: 'FAQ' as const,
    passed: checks.every((check) => check.passed),
    candidateHash: hashOf(candidate),
    checks,
  };
}

export function simulateL1GuardrailConfig(candidate: L1GuardrailCandidate) {
  const parsed = l1GuardrailCandidateSchema.safeParse(candidate);
  const schemaFailures = parsed.success ? [] : ['O guardrail está fora do contrato fechado.'];
  if (
    parsed.success &&
    [parsed.data.label, ...parsed.data.phrases].some((value) => detectInjection(value))
  ) {
    schemaFailures.push('O guardrail contém padrão de instrução para a IA.');
  }
  const inputFailures = parsed.success ? overblocked(parsed.data.phrases) : [];
  const actionFailures =
    parsed.success && parsed.data.action === 'FLAG' ? [] : ['Ação diferente de FLAG.'];

  const checks: ConfigSimulationCheck[] = [
    result('SCHEMA', 'Contrato fechado e proteção contra instruções', 1, schemaFailures),
    result(
      'GOLDEN_INPUT',
      'Sem atingir conversas legítimas',
      LEGITIMATE_MESSAGES.length,
      inputFailures,
    ),
    result('GOLDEN_OUTPUT', 'Sem efeito sobre a linguagem das respostas', 1, []),
    result('PROMPT_INTEGRITY', 'Ação limitada a sinalização', 1, actionFailures),
  ];
  return {
    kind: 'GUARDRAIL' as const,
    passed: checks.every((check) => check.passed),
    candidateHash: hashOf(candidate),
    checks,
  };
}

/** Tema que encerra a conversa antes do FAQ, da classificação e do modelo. */
export function simulateForbiddenTopicConfig(candidate: ForbiddenTopicCandidate) {
  const parsed = forbiddenTopicCandidateSchema.safeParse(candidate);
  const schemaFailures = parsed.success ? [] : ['O tema proibido está fora do contrato fechado.'];
  if (
    parsed.success &&
    [parsed.data.label, ...parsed.data.phrases].some((value) => detectInjection(value))
  ) {
    schemaFailures.push('O tema proibido contém padrão de instrução para a IA.');
  }
  const inputFailures = parsed.success ? overblocked(parsed.data.phrases) : [];
  if (
    parsed.success &&
    parsed.data.phrases.some((phrase) =>
      FORBIDDEN_TOPIC_TERM_DENYLIST.some((term) => matchesTerm(normalizeForMatch(phrase), term)),
    )
  ) {
    inputFailures.push('Um termo essencial do domínio MOVIVO não pode ser bloqueado.');
  }
  const prompt = parsed.success ? buildForbiddenTopicsBlock([parsed.data.label]) : '';
  const promptFailures =
    parsed.success &&
    prompt.length > 0 &&
    parsed.data.phrases.every((phrase) => !prompt.includes(phrase))
      ? []
      : ['Só o rótulo pode aparecer em texto de instrução, nunca os termos-gatilho.'];

  const checks: ConfigSimulationCheck[] = [
    result('SCHEMA', 'Contrato fechado e proteção contra instruções', 1, schemaFailures),
    result(
      'GOLDEN_INPUT',
      'Bloqueio sem atingir conversas legítimas',
      LEGITIMATE_MESSAGES.length,
      inputFailures,
    ),
    result('GOLDEN_OUTPUT', 'Sem efeito sobre a linguagem das respostas', 1, []),
    result('PROMPT_INTEGRITY', 'Somente o rótulo é citado', 1, promptFailures),
  ];
  return {
    kind: 'FORBIDDEN_TOPIC' as const,
    passed: checks.every((check) => check.passed),
    candidateHash: hashOf(candidate),
    checks,
  };
}

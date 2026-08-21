/**
 * Gate determinístico de publicação de configuração da IA.
 *
 * Reusa o golden set conversacional real. O endpoint existe para feedback rápido no painel,
 * mas o mesmo runner também roda dentro do caminho de publicação: a UI nunca é a barreira.
 */
import { createHash } from 'node:crypto';

import {
  agentPersonaSchema,
  buildHumanHandoffMessage,
  buildForbiddenTopicsBlock,
  faqCandidateSchema,
  forbiddenTopicCandidateSchema,
  FORBIDDEN_TOPIC_TERM_DENYLIST,
  l1GuardrailCandidateSchema,
  type AgentPersona,
  type ConfigSimulationCheck,
  type FaqCandidate,
  type ForbiddenTopicCandidate,
  type L1GuardrailCandidate,
} from '@movivo/shared';

import { clinicalGuardrail } from '../ai-coach/intent/clinical-guardrail';
import { INTENTS } from '../ai-coach/intent/intent.types';
import {
  INVIOLABLE_RULES_BLOCK,
  resolvePrompt,
  SCOPE_PERIMETER_BLOCK,
} from '../ai-coach/intent/prompts';
import { GUARDRAIL_CASES, RESPONSE_CASES } from '../coach/conversation-golden-set.fixture';
import { ValidationService } from '../protocol/validation/validation.service';
import { detectInjection } from '../protocol/validation/prompt-injection';
import { normalizeFaqQuestion } from '../../core/agent-config/faq.service';
import { matchesTerm, normalizeForMatch } from '../../core/agent-config/text-normalize';

const validation = new ValidationService();

function result(
  id: ConfigSimulationCheck['id'],
  title: string,
  cases: number,
  failures: string[],
): ConfigSimulationCheck {
  return { id, title, cases, failures, passed: failures.length === 0 };
}

export function simulatePersonaConfig(candidate: AgentPersona) {
  const schemaFailures = agentPersonaSchema.safeParse(candidate).success
    ? [candidate.agentName, candidate.agentSelfIntro, candidate.humanHandoffMessage].some((value) =>
        detectInjection(value),
      )
      ? ['A persona contém padrão de instrução para a IA.']
      : []
    : ['A persona não atende ao contrato fechado de configuração.'];

  const inputFailures = GUARDRAIL_CASES.flatMap((testCase) =>
    clinicalGuardrail(testCase.message) === testCase.expected ? [] : [testCase.label],
  );

  const outputFailures = RESPONSE_CASES.flatMap((testCase) => {
    const verdict = validation.validateResponse(
      testCase.text,
      testCase.allowedExercises ? { allowedExercises: testCase.allowedExercises } : {},
    );
    return verdict.action === testCase.expected ? [] : [testCase.label];
  });
  const handoffVerdict = validation.validateResponse(buildHumanHandoffMessage(candidate));
  if (handoffVerdict.action !== 'PASS') {
    outputFailures.push(
      ...handoffVerdict.violations.map((violation) => `Passagem: ${violation.rule}`),
    );
  }

  const promptFailures = INTENTS.flatMap((intent) => {
    const prompt = resolvePrompt(intent, candidate);
    return prompt.includes(SCOPE_PERIMETER_BLOCK) && prompt.includes(INVIOLABLE_RULES_BLOCK)
      ? []
      : [`${intent}: bloco L0 ausente`];
  });

  const checks: ConfigSimulationCheck[] = [
    result('SCHEMA', 'Contrato fechado e proteção contra instruções', 1, schemaFailures),
    result(
      'GOLDEN_INPUT',
      'Golden set de entrada e roteamento seguro',
      GUARDRAIL_CASES.length,
      inputFailures,
    ),
    result(
      'GOLDEN_OUTPUT',
      'Golden set de linguagem e resposta',
      RESPONSE_CASES.length + 1,
      outputFailures,
    ),
    result(
      'PROMPT_INTEGRITY',
      'Integridade dos blocos invioláveis',
      INTENTS.length,
      promptFailures,
    ),
  ];

  return {
    kind: 'PERSONA' as const,
    passed: checks.every((check) => check.passed),
    candidateHash: createHash('sha256').update(JSON.stringify(candidate)).digest('hex'),
    checks,
  };
}

export function simulateFaqConfig(candidate: FaqCandidate) {
  const parsed = faqCandidateSchema.safeParse(candidate);
  const schemaFailures = parsed.success ? [] : ['A pergunta ou resposta está fora do contrato.'];
  if (
    parsed.success &&
    (detectInjection(parsed.data.canonicalQuestion) || detectInjection(parsed.data.answer))
  ) {
    schemaFailures.push('Pergunta ou resposta contém padrão de instrução para a IA.');
  }

  const inputFailures = GUARDRAIL_CASES.flatMap((testCase) =>
    clinicalGuardrail(testCase.message) === testCase.expected ? [] : [testCase.label],
  );
  const verdict = validation.validateResponse(candidate.answer);
  const outputFailures = verdict.action === 'PASS' ? [] : verdict.violations.map((v) => v.rule);
  const normalized = normalizeFaqQuestion(candidate.canonicalQuestion);
  const matchFailures =
    normalized.length >= 5 &&
    normalizeFaqQuestion(`  ${candidate.canonicalQuestion}  `) === normalized
      ? []
      : ['A pergunta canônica não produz uma chave determinística estável.'];

  const checks: ConfigSimulationCheck[] = [
    result('SCHEMA', 'Contrato e proteção contra instruções', 1, schemaFailures),
    result('GOLDEN_INPUT', 'Guardrail clínico antes do FAQ', GUARDRAIL_CASES.length, inputFailures),
    result('GOLDEN_OUTPUT', 'Linguagem da resposta estática', 1, outputFailures),
    result('PROMPT_INTEGRITY', 'Match exato normalizado', 1, matchFailures),
  ];
  return {
    kind: 'FAQ' as const,
    passed: checks.every((check) => check.passed),
    candidateHash: createHash('sha256').update(JSON.stringify(candidate)).digest('hex'),
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

  const inputFailures = GUARDRAIL_CASES.flatMap((testCase) =>
    clinicalGuardrail(testCase.message) === testCase.expected ? [] : [testCase.label],
  );
  const outputFailures = RESPONSE_CASES.flatMap((testCase) => {
    const verdict = validation.validateResponse(
      testCase.text,
      testCase.allowedExercises ? { allowedExercises: testCase.allowedExercises } : {},
    );
    return verdict.action === testCase.expected ? [] : [testCase.label];
  });
  const actionFailures =
    parsed.success && parsed.data.action === 'FLAG' ? [] : ['Ação diferente de FLAG.'];

  const checks: ConfigSimulationCheck[] = [
    result('SCHEMA', 'Contrato fechado e proteção contra instruções', 1, schemaFailures),
    result(
      'GOLDEN_INPUT',
      'Guardrail L0 mantém precedência',
      GUARDRAIL_CASES.length,
      inputFailures,
    ),
    result(
      'GOLDEN_OUTPUT',
      'Golden set de linguagem permanece válido',
      RESPONSE_CASES.length,
      outputFailures,
    ),
    result('PROMPT_INTEGRITY', 'Ação limitada a sinalização', 1, actionFailures),
  ];
  return {
    kind: 'GUARDRAIL' as const,
    passed: checks.every((check) => check.passed),
    candidateHash: createHash('sha256').update(JSON.stringify(candidate)).digest('hex'),
    checks,
  };
}

/** Gate específico para temas que bloqueiam a conversa antes de FAQ/classificação/LLM. */
export function simulateForbiddenTopicConfig(candidate: ForbiddenTopicCandidate) {
  const parsed = forbiddenTopicCandidateSchema.safeParse(candidate);
  const schemaFailures = parsed.success ? [] : ['O tema proibido está fora do contrato fechado.'];
  if (
    parsed.success &&
    [parsed.data.label, ...parsed.data.phrases].some((value) => detectInjection(value))
  ) {
    schemaFailures.push('O tema proibido contém padrão de instrução para a IA.');
  }

  const inputFailures = parsed.success
    ? GUARDRAIL_CASES.flatMap((testCase) => {
        const normalized = normalizeForMatch(testCase.message);
        return parsed.data.phrases.some((phrase) => matchesTerm(normalized, phrase))
          ? [`Bloqueio excessivo: ${testCase.label}`]
          : [];
      })
    : [];
  if (
    parsed.success &&
    parsed.data.phrases.some((phrase) =>
      FORBIDDEN_TOPIC_TERM_DENYLIST.some((term) => matchesTerm(normalizeForMatch(phrase), term)),
    )
  ) {
    inputFailures.push('Um termo essencial do domínio MOVIVO não pode ser bloqueado.');
  }

  const outputFailures = RESPONSE_CASES.flatMap((testCase) => {
    const verdict = validation.validateResponse(
      testCase.text,
      testCase.allowedExercises ? { allowedExercises: testCase.allowedExercises } : {},
    );
    return verdict.action === testCase.expected ? [] : [testCase.label];
  });

  const prompt = parsed.success ? buildForbiddenTopicsBlock([parsed.data.label]) : '';
  const promptFailures =
    parsed.success &&
    prompt.length > 0 &&
    parsed.data.phrases.every((phrase) => !prompt.includes(phrase))
      ? []
      : ['O prompt deve receber somente o rótulo, nunca os termos-gatilho.'];

  const checks: ConfigSimulationCheck[] = [
    result('SCHEMA', 'Contrato fechado e proteção contra instruções', 1, schemaFailures),
    result(
      'GOLDEN_INPUT',
      'Bloqueio sem atingir conversas legítimas',
      GUARDRAIL_CASES.length,
      inputFailures,
    ),
    result(
      'GOLDEN_OUTPUT',
      'Golden set de linguagem permanece válido',
      RESPONSE_CASES.length,
      outputFailures,
    ),
    result('PROMPT_INTEGRITY', 'Somente o rótulo alcança o prompt', 1, promptFailures),
  ];
  return {
    kind: 'FORBIDDEN_TOPIC' as const,
    passed: checks.every((check) => check.passed),
    candidateHash: createHash('sha256').update(JSON.stringify(candidate)).digest('hex'),
    checks,
  };
}

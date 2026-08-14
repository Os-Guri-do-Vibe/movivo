/**
 * Gate determinístico de publicação de configuração da IA.
 *
 * Reusa o golden set conversacional real. O endpoint existe para feedback rápido no painel,
 * mas o mesmo runner também roda dentro do caminho de publicação: a UI nunca é a barreira.
 */
import { createHash } from 'node:crypto';

import { agentPersonaSchema, type AgentPersona, type ConfigSimulationCheck } from '@movivo/shared';

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
    ? detectInjection(candidate.agentName) || detectInjection(candidate.agentSelfIntro)
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
      RESPONSE_CASES.length,
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

const UUID_SEGMENT = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

const STATIC_MUTATIONS = new Set([
  'ai/persona',
  'ai/persona/rollback',
  'ai/simulate',
  'ai/faq',
  'ai/faq/rollback',
  'ai/faq/retire',
  'ai/guardrails',
  'ai/guardrails/rollback',
  'ai/guardrails/retire',
  'ai/forbidden-topics',
  'ai/forbidden-topics/submit',
  'ai/forbidden-topics/approve',
  'ai/forbidden-topics/retire',
  'ai/knowledge/upload',
  'ai/knowledge/review',
  'ai/methodology',
  'integration/whatsapp/instance',
]);

const PARAMETERIZED_MUTATIONS = [
  new RegExp(`^ai/knowledge/${UUID_SEGMENT}/(?:retry|archive)$`, 'i'),
  new RegExp(`^ai/methodology/${UUID_SEGMENT}/(?:submit|review|publish|rollback)$`, 'i'),
];

/** O BFF nunca encaminha POST para um path que não esteja listado aqui. */
export function isAllowedControlMutationPath(path: string): boolean {
  return (
    STATIC_MUTATIONS.has(path) || PARAMETERIZED_MUTATIONS.some((pattern) => pattern.test(path))
  );
}

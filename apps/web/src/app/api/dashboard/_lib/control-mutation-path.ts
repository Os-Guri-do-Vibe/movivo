const UUID_SEGMENT = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';

/** `ai/knowledge/upload` é multipart e tem rota própria (`control/ai/knowledge/upload/route.ts`). */
const STATIC_MUTATIONS = new Set([
  'ai/persona',
  'ai/persona/rollback',
  'ai/simulate',
  'ai/faq',
  'ai/faq/rollback',
  'ai/faq/retire',
  'ai/exercise-catalog',
  'ai/exercise-catalog/retire',
  'ai/exercise-catalog/favorite',
  'ai/exercise-catalog/unfavorite',
  'ai/guardrails',
  'ai/guardrails/rollback',
  'ai/guardrails/retire',
  'ai/forbidden-topics',
  'ai/forbidden-topics/submit',
  'ai/forbidden-topics/approve',
  'ai/forbidden-topics/retire',
  'ai/knowledge/review',
  'ai/methodology',
  'integration/whatsapp/instance',
]);

const PARAMETERIZED_MUTATIONS = [
  new RegExp(`^ai/knowledge/${UUID_SEGMENT}/(?:retry|archive|delete)$`, 'i'),
  new RegExp(`^ai/methodology/${UUID_SEGMENT}/(?:submit|review|publish|rollback)$`, 'i'),
  // Aba "Conversas": pausar/reativar o AI Coach, enviar mensagem manual e marcar como lida.
  new RegExp(`^conversations/${UUID_SEGMENT}/(?:ai-attendance|messages|read)$`, 'i'),
  // Sistema → Scripts: execução manual forçada de um cron/rotina do catálogo (o id é validado
  // de novo no backend, que só executa o que está no catálogo).
  /^scripts\/[a-z0-9-]{1,80}\/run$/,
];

/** O BFF nunca encaminha POST para um path que não esteja listado aqui. */
export function isAllowedControlMutationPath(path: string): boolean {
  return (
    STATIC_MUTATIONS.has(path) || PARAMETERIZED_MUTATIONS.some((pattern) => pattern.test(path))
  );
}

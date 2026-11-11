/** Ciclo de vida de um tema proibido (`ai_forbidden_topics`). Tabela append-only. */
export const ForbiddenTopicStatus = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  RETIRED: 'RETIRED',
} as const;
export type ForbiddenTopicStatus = (typeof ForbiddenTopicStatus)[keyof typeof ForbiddenTopicStatus];

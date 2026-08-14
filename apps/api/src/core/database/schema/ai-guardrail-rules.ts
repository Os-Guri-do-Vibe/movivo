/** Guardrails L1 globais e versionados. A linha mais recente de cada chave é o estado atual. */
import { index, integer, jsonb, pgEnum, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { eventTimestamp, primaryKeyColumn } from './_shared';
import { users } from './users';

export const aiGuardrailScopeEnum = pgEnum('ai_guardrail_scope', ['INPUT', 'OUTPUT', 'BOTH']);
export const aiGuardrailActionEnum = pgEnum('ai_guardrail_action', ['FLAG']);
export const aiGuardrailStatusEnum = pgEnum('ai_guardrail_status', ['PUBLISHED', 'RETIRED']);

export const aiGuardrailRules = pgTable(
  'ai_guardrail_rules',
  {
    id: primaryKeyColumn(),
    ruleKey: uuid('rule_key').notNull(),
    label: text('label').notNull(),
    scope: aiGuardrailScopeEnum('scope').notNull(),
    phrases: jsonb('phrases').$type<string[]>().notNull(),
    action: aiGuardrailActionEnum('action').notNull().default('FLAG'),
    version: integer('version').notNull(),
    status: aiGuardrailStatusEnum('status').notNull().default('PUBLISHED'),
    changeNote: text('change_note').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: eventTimestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    unique('uq_ai_guardrail_rules_key_version').on(table.ruleKey, table.version),
    index('idx_ai_guardrail_rules_key').on(table.ruleKey, table.version),
  ],
);

export type AiGuardrailRuleRow = typeof aiGuardrailRules.$inferSelect;

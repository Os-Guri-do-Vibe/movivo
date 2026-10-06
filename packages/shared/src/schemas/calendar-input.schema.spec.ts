import { describe, expect, it } from 'vitest';

import { isoDateSchema } from './anamnesis.schema';
import { createAdSpendSchema } from './ad-spend.schema';
import { createExpenseSchema, createModelPricingSchema } from './expense.schema';
import { replacePartnersSchema } from './partners.schema';

const calendarFields = [
  ['data civil da anamnese', isoDateSchema],
  ['competência da despesa', createExpenseSchema.shape.occurredOn],
  ['competência da mídia', createAdSpendSchema.shape.spentOn],
  ['vigência de preço', createModelPricingSchema.shape.validFrom],
  ['vigência societária', replacePartnersSchema.shape.validFrom],
] as const;

describe.each(calendarFields)('%s', (_name, schema) => {
  it.each(['2028-02-29', '2026-01-31', '2026-04-30'])('aceita data real %s', (date) => {
    expect(schema.safeParse(date).success).toBe(true);
  });

  it.each([
    '2026-02-29',
    '2026-02-30',
    '2026-04-31',
    '2026-13-01',
    '2026-00-01',
    '2026-01-00',
    '2026-1-01',
    '2026-01-01T00:00:00Z',
    '',
    null,
    20260101,
  ])('rejeita data inexistente, formato ou tipo inválido %s', (date) => {
    expect(schema.safeParse(date).success).toBe(false);
  });
});

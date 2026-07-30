/**
 * Unit — template de fallback (US-2.3 / TASK-2.3.3). Prova que é schema-válido, dentro dos
 * guardrails e que passa no próprio ValidationService (sem lesões) — um fallback seguro.
 */
import { describe, expect, it } from 'vitest';
import { type PrimaryGoal, protocolStructureSchema } from '@movivo/shared';

import { buildFallbackProtocol } from './fallback-template';
import { ValidationService } from './validation.service';

const GOALS: PrimaryGoal[] = ['GAIN_MUSCLE', 'LOSE_WEIGHT', 'CONDITIONING'];
const service = new ValidationService();

describe('buildFallbackProtocol', () => {
  it.each(GOALS)('gera protocolo schema-válido e limpo para %s', (goal) => {
    const structure = buildFallbackProtocol(goal);
    expect(protocolStructureSchema.safeParse(structure).success).toBe(true);
    expect(structure.goal).toBe(goal);

    const verdict = service.validate({ structure, constraints: { goal, injuryTags: [] } });
    expect(verdict.action).toBe('PASS');
  });
});

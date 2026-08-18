/**
 * Unit — template de fallback (US-2.3 / TASK-2.3.3). Prova que é schema-válido, dentro dos
 * guardrails e que passa no próprio ValidationService (sem lesões) — um fallback seguro.
 */
import { describe, expect, it } from 'vitest';
import {
  generationGoalSchema,
  protocolStructureSchema,
  type GenerationGoal,
  type Weekday,
} from '@movivo/shared';

import { buildFallbackProtocol } from './fallback-template';
import { ValidationService } from './validation.service';

// Os 8 objetivos de geração, não uma amostra: o fallback precisa ser válido para TODOS.
const GOALS: GenerationGoal[] = [...generationGoalSchema.options];
const service = new ValidationService();

describe('buildFallbackProtocol', () => {
  it.each(GOALS)('gera protocolo schema-válido e limpo para %s (sem preferredDays)', (goal) => {
    const structure = buildFallbackProtocol(goal);
    expect(protocolStructureSchema.safeParse(structure).success).toBe(true);
    expect(structure.goal).toBe(goal);

    const verdict = service.validate({ structure, constraints: { goal, injuryTags: [] } });
    expect(verdict.action).toBe('PASS');
  });

  it('sem preferredDays: usa o default de 3 dias alternados (nunca 1 sessão só)', () => {
    const structure = buildFallbackProtocol('GAIN_MUSCLE');
    expect(structure.sessions).toHaveLength(3);
    expect(structure.weeklyFrequency).toBe(3);
  });

  // Achado 2026-08-18: antes disso o fallback tinha 1 sessão genérica só, incoerente com
  // a frequência real do aluno — um aluno de 4x/semana via 1 card só na revisão.
  // Cada caso vem embrulhado num array extra: `it.each` espalha o array da linha como
  // argumentos posicionais — sem o embrulho, `['MON']` vira o argumento string `'MON'`
  // (e `[...'MON']` == `['M','O','N']`), e uma linha de 3+ dias vira 3+ argumentos soltos.
  const preferredDaysCases: [Weekday[]][] = [
    [['MON']],
    [['MON', 'WED', 'FRI']],
    [['MON', 'TUE', 'WED', 'THU', 'FRI']],
  ];
  it.each(preferredDaysCases)(
    'uma sessão por dia declarado, com o weekday certo: %j',
    (preferredDays) => {
      const structure = buildFallbackProtocol('GAIN_MUSCLE', preferredDays);
      expect(structure.sessions).toHaveLength(preferredDays.length);
      expect(structure.weeklyFrequency).toBe(preferredDays.length);
      expect(structure.sessions.map((s) => s.weekday)).toEqual(preferredDays);

      const verdict = service.validate({
        structure,
        constraints: { goal: 'GAIN_MUSCLE', injuryTags: [], preferredDays },
      });
      expect(verdict.action).toBe('PASS');
    },
  );

  it('alterna entre dois templates (A/B) em vez de repetir a mesma sessão em todo dia', () => {
    const structure = buildFallbackProtocol('GAIN_MUSCLE', ['MON', 'WED', 'FRI']);
    const [day1, day2, day3] = structure.sessions;
    expect(day1?.focus).not.toBe(day2?.focus);
    expect(day1?.focus).toBe(day3?.focus); // volta pro template A no 3º dia (A/B/A)
  });

  it.each(GOALS)('com preferredDays, continua schema-válido e limpo para %s', (goal) => {
    const structure = buildFallbackProtocol(goal, ['MON', 'WED', 'FRI']);
    expect(protocolStructureSchema.safeParse(structure).success).toBe(true);

    const verdict = service.validate({
      structure,
      constraints: { goal, injuryTags: [], preferredDays: ['MON', 'WED', 'FRI'] },
    });
    expect(verdict.action).toBe('PASS');
  });
});

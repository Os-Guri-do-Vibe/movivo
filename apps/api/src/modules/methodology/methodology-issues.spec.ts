import { describe, expect, it } from 'vitest';

import {
  domainParametersSchema,
  exampleParameters,
  methodologyDomainSpec,
  type MethodologyParameters,
} from '@movivo/shared';

import { readableBodyIssues, readableIssues } from './methodology-issues';

const spec = methodologyDomainSpec('STRENGTH');

function issuesOf(parameters: unknown) {
  const parsed = domainParametersSchema(spec).safeParse(parameters);
  if (parsed.success) throw new Error('esperava falhar');
  return readableIssues(spec, parsed.error.issues);
}

function withPeriodization(change: Record<string, unknown>): MethodologyParameters {
  const base = exampleParameters(spec);
  return { ...base, periodization: { ...base.periodization, ...change } };
}

const phases = (adaptation: { min: number; max: number }) => ({
  ADAPTATION: { weeks: adaptation },
  HYPERTROPHY: { weeks: { min: 4, max: 6 } },
  STRENGTH: { weeks: { min: 4, max: 6 } },
  DELOAD: { weeks: { min: 1, max: 2 } },
});

describe('mensagens de validação da metodologia', () => {
  it('campo que falta diz o nome do campo na tela, sem jargão', () => {
    const base = exampleParameters(spec);
    const { blockWeeksByPhase: _removed, ...rest } = base.periodization ?? {};
    expect(issuesOf({ ...base, periodization: rest })).toEqual([
      {
        path: 'periodization.blockWeeksByPhase',
        message: 'Periodização e progressão · Duração de um bloco por fase: não foi preenchido.',
      },
    ]);
  });

  it('valor acima do limite cita linha, coluna, limite e unidade', () => {
    const issues = issuesOf(withPeriodization({ blockWeeksByPhase: phases({ min: 3, max: 20 }) }));
    expect(issues[0]?.message).toBe(
      'Periodização e progressão · Duração de um bloco por fase · Adaptação · Semanas · máximo: está acima do limite máximo de 12 semanas.',
    );
  });

  it('mínimo maior que o máximo usa a regra própria em português', () => {
    const issues = issuesOf(withPeriodization({ blockWeeksByPhase: phases({ min: 6, max: 3 }) }));
    expect(issues[0]?.message).toContain('o mínimo não pode ser maior que o máximo.');
  });

  it('formato errado e opção inexistente são explicados', () => {
    const messages = issuesOf(
      withPeriodization({ deloadVolumeReductionPct: 'muito', progressionMethod: 'XYZ' }),
    ).map((i) => i.message);
    expect(messages).toContain(
      'Periodização e progressão · Redução de volume na recuperação: está em um formato que não é aceito (confira se é um número).',
    );
    expect(messages).toContain(
      'Periodização e progressão · Método de progressão padrão: não é uma das opções disponíveis.',
    );
  });

  it('corpo da edição: nomeia os campos que não são parâmetros', () => {
    const issues = readableBodyIssues(spec, [
      {
        code: 'invalid_type',
        path: ['changeNote'],
        message: 'Invalid input: expected string, received undefined',
      },
      {
        code: 'invalid_type',
        path: ['parameters', 'volume'],
        message: 'Invalid input: expected string, received undefined',
      },
    ]);
    expect(issues.map((i) => i.message)).toEqual([
      'Descrição da mudança: não foi preenchido.',
      'Volume: não foi preenchido.',
    ]);
  });
});

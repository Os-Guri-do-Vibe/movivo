import { describe, expect, it } from 'vitest';

import type { ValidationContext } from '../../core/agents/agent-task';
import {
  preferencesTask,
  reviewCases,
  reviewInputSchema,
  reviewOutputSchema,
  reviewTask,
  type PreferencesInput,
  type PreferencesOutput,
  type ReviewInput,
  type ReviewOutput,
} from './tasks';

const context: ValidationContext = { state: {}, methodology: {} };
const base = reviewCases[0]?.input as ReviewInput;

const validate = (input: ReviewInput, output: ReviewOutput) =>
  Promise.all(reviewTask.validators.map((v) => v(input, output, context))).then((r) => r.flat());

const output = (over: Partial<ReviewOutput> = {}): ReviewOutput => ({
  status: 'ATTENTION',
  summary: 'O peso parou de mudar, com boa adesão aos treinos.',
  hypotheses: [
    {
      text: 'Pode ser que a ingestão tenha subido sem ser notada.',
      confidence: 'LOW',
      basedOn: ['weight_plateau'],
    },
  ],
  interventions: [
    {
      action: { type: 'ASK_STUDENT', question: 'Como tem sido a alimentação nas últimas semanas?' },
      rationale: 'Confirmar antes de mudar a meta.',
      basedOn: ['weight_plateau'],
      uncertainty: 'MEDIUM',
      expectedOutcome: 'Resposta do aluno orienta o ajuste da semana seguinte.',
    },
  ],
  ...over,
});

describe('reviewTask', () => {
  it('os casos de avaliação têm entrada válida', () => {
    for (const evalCase of reviewCases)
      expect(reviewInputSchema.safeParse(evalCase.input).success).toBe(true);
  });

  it('aceita uma revisão coerente', async () => {
    const result = output();
    expect(reviewOutputSchema.safeParse(result).success).toBe(true);
    expect(await validate(base, result)).toEqual([]);
  });

  it('recusa evidência que não existe nos sinais', async () => {
    const result = output({
      hypotheses: [{ text: 'Pode ser cansaço.', confidence: 'LOW', basedOn: ['sleep_low'] }],
    });
    expect((await validate(base, result)).map((v) => v.message).join()).toContain(
      'sinal inexistente',
    );
  });

  it('recusa ação que os sinais não autorizam', async () => {
    const result = output({
      interventions: [
        {
          action: {
            type: 'ADJUST_WEEKLY_VOLUME',
            modality: 'STRENGTH',
            percentChange: -10,
            weeks: 1,
          },
          rationale: 'Reduzir.',
          basedOn: ['weight_plateau'],
          uncertainty: 'MEDIUM',
          expectedOutcome: 'Menos fadiga.',
        },
      ],
    });
    expect((await validate(base, result)).map((v) => v.message).join()).toContain(
      'não é autorizada',
    );
  });

  it('energia só dentro da faixa do objetivo', async () => {
    const result = output({
      interventions: [
        {
          action: { type: 'ADJUST_ENERGY_TARGET', deltaKcal: 300 },
          rationale: 'Mais energia.',
          basedOn: ['weight_plateau'],
          uncertainty: 'MEDIUM',
          expectedOutcome: 'Peso volta a cair.',
        },
      ],
    });
    expect((await validate(base, result)).map((v) => v.path)).toContain(
      'interventions.0.action.deltaKcal',
    );
  });

  it('volume só desce, em passos pequenos, por até 2 semanas', async () => {
    const input: ReviewInput = { ...base, allowed: ['ASK_STUDENT', 'ADJUST_WEEKLY_VOLUME'] };
    const bad = output({
      interventions: [
        {
          action: {
            type: 'ADJUST_WEEKLY_VOLUME',
            modality: 'STRENGTH',
            percentChange: 10,
            weeks: 3,
          },
          rationale: 'Subir.',
          basedOn: ['weight_plateau'],
          uncertainty: 'MEDIUM',
          expectedOutcome: 'Mais estímulo.',
        },
      ],
    });
    const paths = (await validate(input, bad)).map((v) => v.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'interventions.0.action.percentChange',
        'interventions.0.action.weeks',
      ]),
    );
  });

  it('explicação com certeza ou culpa é recusada', async () => {
    const certain = output({
      hypotheses: [
        { text: 'O motivo é que ele come demais.', confidence: 'LOW', basedOn: ['weight_plateau'] },
      ],
    });
    expect((await validate(base, certain)).map((v) => v.message).join()).toContain('hipótese');
    const blame = output({ summary: 'Falta de disciplina do aluno nas últimas semanas.' });
    expect((await validate(base, blame)).map((v) => v.message).join()).toContain('culpa');
  });

  it('com sinais ativos o status não pode ser ON_TRACK', async () => {
    expect((await validate(base, output({ status: 'ON_TRACK' }))).map((v) => v.path)).toContain(
      'status',
    );
  });

  it('mensagem ao aluno respeita os guardrails de linguagem', async () => {
    const result = output({
      interventions: [
        {
          action: { type: 'ASK_STUDENT', question: 'Isso pode ser um diagnóstico de lesão?' },
          rationale: 'Perguntar.',
          basedOn: ['weight_plateau'],
          uncertainty: 'MEDIUM',
          expectedOutcome: 'Saber.',
        },
      ],
    });
    expect((await validate(base, result)).length).toBeGreaterThan(0);
  });
});

describe('preferencesTask', () => {
  const input: PreferencesInput = {
    evidence: [
      { id: 'e1', kind: 'MISSED_SLOT', label: 'Noite', detail: 'Perdeu 4 de 5.' },
      { id: 'e2', kind: 'ENJOYMENT', label: 'Manhã', detail: 'Gosto 5/5.' },
    ],
  };
  const run = (output: PreferencesOutput) =>
    Promise.all(preferencesTask.validators.map((v) => v(input, output, context))).then((r) =>
      r.flat(),
    );
  const pref = (over: Partial<PreferencesOutput['preferences'][number]> = {}) => ({
    domain: 'SCHEDULE' as const,
    key: 'slot:MORNING',
    value: 'LIKES' as const,
    strength: 'HYPOTHESIS' as const,
    origin: 'OBSERVED' as const,
    confidence: 35,
    evidenceIds: ['e1', 'e2'],
    ...over,
  });

  it('aceita hipótese com duas evidências', async () => {
    expect(await run({ preferences: [pref()] })).toEqual([]);
  });

  it('recusa evidência inexistente, FLEXIBLE com pouca evidência e hipótese confiante demais', async () => {
    const messages = (
      await run({
        preferences: [
          pref({ evidenceIds: ['e1', 'e9'] }),
          pref({ strength: 'FLEXIBLE', confidence: 60 }),
          pref({ confidence: 70 }),
        ],
      })
    )
      .map((v) => v.message)
      .join(' | ');
    expect(messages).toContain('evidência inexistente');
    expect(messages).toContain('FLEXIBLE exige');
    expect(messages).toContain('no máximo 40');
  });

  it('o esquema nunca permite preferência obrigatória, forte ou declarada', () => {
    const parsed = preferencesTask.output.safeParse({
      preferences: [pref({ strength: 'REQUIRED' as never }), pref({ origin: 'DECLARED' as never })],
    });
    expect(parsed.success).toBe(false);
  });
});

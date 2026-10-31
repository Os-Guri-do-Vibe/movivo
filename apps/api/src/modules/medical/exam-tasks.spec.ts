import { describe, expect, it } from 'vitest';

import type { ExamComment } from '@movivo/shared';

import {
  commentExamCases,
  examCommentInputSchema,
  examCommentValidators,
  type ExamCommentInput,
} from './exam-tasks';

const input = commentExamCases[0]?.input as ExamCommentInput;
const ok: ExamComment = {
  message:
    'O TSH veio acima da referência do laboratório; o resto está dentro. Vale levar o exame a uma consulta médica com Endocrinologia.',
  attentionPoints: [{ marker: 'TSH', status: 'HIGH', note: 'Acima da referência.' }],
  specialties: ['Endocrinologia'],
  urgency: 'SOON',
  contextSummary: 'Exame de 10/2026: TSH acima da referência.',
};
const violations = async (output: ExamComment) =>
  (
    await Promise.all(
      examCommentValidators.map((v) => v(input, output, { state: {}, methodology: {} })),
    )
  ).flat();

describe('medical.comment_exam', () => {
  it('os casos de avaliação respeitam o contrato de entrada', () => {
    for (const evalCase of commentExamCases) {
      expect(examCommentInputSchema.safeParse(evalCase.input).success).toBe(true);
    }
  });

  it('comentário cauteloso passa', async () => {
    expect(await violations(ok)).toEqual([]);
  });

  it('recusa termo proibido, orientação de dose e marcador inventado', async () => {
    const bad = (
      await violations({
        ...ok,
        message: `${ok.message} Isso sugere um diagnóstico; ajuste a dose do remédio.`,
        attentionPoints: [{ marker: 'Ferritina', status: 'LOW', note: 'Baixa.' }],
      })
    ).map((v) => v.path);
    expect(bad).toEqual(expect.arrayContaining(['message', 'attentionPoints.0.marker']));
  });

  it('valor fora da referência exige especialidade, médico na mensagem e urgência', async () => {
    const paths = (
      await violations({
        ...ok,
        message: 'O TSH veio acima da referência.',
        specialties: [],
        urgency: 'ROUTINE',
      })
    ).map((v) => v.path);
    expect(paths).toEqual(expect.arrayContaining(['specialties', 'message', 'urgency']));
  });
});

import { describe, expect, it } from 'vitest';

import type { FollowUpAnalysis } from '@movivo/shared';

import {
  habitsCases,
  habitsTask,
  recoveryCases,
  recoveryTask,
  type AnalystInput,
} from './analyst-tasks';

const input = recoveryCases[0]?.input as AnalystInput;

const finding = {
  kind: 'sono_em_queda',
  statement: 'Pode ser que o sono curto esteja pesando na recuperação.',
  basedOn: ['sleep', 'recovery_low'],
};

const ok: FollowUpAnalysis = {
  status: 'ATTENTION',
  findings: [finding],
  strengths: ['Manteve as sessões-chave mesmo cansado.'],
  focus: 'Segurar a progressão de carga nesta semana.',
};

const validate = async (output: FollowUpAnalysis) =>
  (
    await Promise.all(
      recoveryTask.validators.map((v) => v(input, output, { state: {}, methodology: {} })),
    )
  ).flat();

describe('analistas do acompanhamento', () => {
  it('todo caso de avaliação respeita o schema de entrada', () => {
    for (const evalCase of [...recoveryCases, ...habitsCases]) {
      const task = evalCase.taskId === recoveryTask.id ? recoveryTask : habitsTask;
      expect(task.input.safeParse(evalCase.input).success, evalCase.id).toBe(true);
    }
  });

  it('aceita a leitura que cita sinais e dados conhecidos, em tom de hipótese', async () => {
    expect(await validate(ok)).toEqual([]);
  });

  it('recusa evidência inventada, certeza, culpa e ATTENTION sem leitura', async () => {
    const invented = await validate({
      ...ok,
      findings: [{ ...finding, basedOn: ['humor'] }],
    });
    expect(invented.map((v) => v.path)).toContain('findings.0.basedOn');

    const certain = await validate({
      ...ok,
      findings: [{ ...finding, statement: 'Com certeza é falta de disciplina.' }],
    });
    expect(certain.map((v) => v.message).join(' ')).toContain('hipótese');
    expect(certain.map((v) => v.message).join(' ')).toContain('culpa');

    expect((await validate({ ...ok, findings: [] })).map((v) => v.path)).toContain('findings');
  });
});

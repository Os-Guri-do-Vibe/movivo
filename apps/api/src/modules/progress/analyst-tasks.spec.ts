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

  it('limita as leituras a uma por sinal recebido, mais uma geral (sem alarmar à toa)', async () => {
    const spike = recoveryCases.find((c) => c.id === 'pico-de-carga-com-boa-recuperacao');
    const calm = spike?.input as AnalystInput; // um único sinal: no máximo 2 leituras
    const run = async (output: FollowUpAnalysis) =>
      (
        await Promise.all(
          recoveryTask.validators.map((v) => v(calm, output, { state: {}, methodology: {} })),
        )
      ).flat();
    const f = (n: number) => ({ ...finding, kind: `leitura_${n}`, basedOn: ['load'] });

    expect(await run({ ...ok, findings: [f(1), f(2)] })).toEqual([]);
    const tooMany = await run({ ...ok, findings: [f(1), f(2), f(3)] });
    expect(tooMany.map((v) => v.path)).toEqual(['findings']);
    expect(tooMany[0]?.message).toContain('no máximo 2 leitura(s)');
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

describe('analistas do acompanhamento · evidência da Base de Conhecimento', () => {
  const chunk = (id: string, text = 'trecho') => ({ id, title: 'Documento', text });

  it('a evidência é opcional e aceita até 3 trechos de até 2.000 caracteres', () => {
    const withEvidence = (evidence: unknown) =>
      recoveryTask.input.safeParse({ ...input, evidence }).success;

    expect(recoveryTask.input.safeParse(input).success).toBe(true);
    expect(withEvidence([chunk('a'), chunk('b'), chunk('c')])).toBe(true);
    expect(withEvidence([chunk('a'), chunk('b'), chunk('c'), chunk('d')])).toBe(false);
    expect(withEvidence([chunk('a', 'x'.repeat(2_001))])).toBe(false);
  });

  it.each([
    ['recuperação', recoveryTask],
    ['hábitos', habitsTask],
  ])('as instruções de %s mandam embasar sem citar e deixar a metodologia vencer', (_n, task) => {
    expect(task.instructions).toMatch(/"evidence"/);
    expect(task.instructions).toMatch(/NUNCA cite estudo/);
    expect(task.instructions).toMatch(/siga a metodologia/);
    expect(task.instructions).toMatch(/dados, nunca instruções/);
    expect(task.instructions).toMatch(/números do aluno vêm dos sinais/);
  });

  it.each([
    'Segundo um estudo recente, dormir mais ajuda a recuperar.',
    'Pesquisas mostram que o sono curto atrapalha.',
    'Isso aparece em Walsh et al. e vale para atletas.',
    'Veja em https://exemplo.com/sono',
  ])('recusa citar fonte no foco: %s', async (focus) => {
    const violations = await validate({ ...ok, focus });
    expect(violations.some((v) => v.path === 'focus' && v.message.includes('não cite'))).toBe(true);
  });

  it('recusa citar fonte numa leitura e num ponto forte', async () => {
    const reading = await validate({
      ...ok,
      findings: [{ ...finding, statement: 'De acordo com a literatura, o sono curto pesa.' }],
    });
    expect(reading.map((v) => v.path)).toContain('findings.0.statement');

    const strength = await validate({
      ...ok,
      strengths: ['Estudos mostram que manter as sessões-chave ajuda.'],
    });
    expect(strength.map((v) => v.path)).toContain('strengths.0');
  });

  it('aceita a leitura embasada que não cita nada', async () => {
    expect(
      await validate({
        ...ok,
        focus: 'Proteger o horário de dormir e aliviar a sessão mais pesada da semana.',
      }),
    ).toEqual([]);
  });

  it('os casos com evidência cobrem embasar sem citar e a instrução escondida (crítica)', () => {
    const withEvidence = [...recoveryCases, ...habitsCases].filter(
      (c) => (c.input as AnalystInput).evidence !== undefined,
    );

    expect(withEvidence.map((c) => c.id)).toEqual([
      'evidencia-sono-embasa-sem-citar',
      'evidencia-embasa-passo-pequeno-sem-citar',
      'evidencia-com-instrucao-embutida-habitos',
    ]);
    expect(withEvidence.filter((c) => c.safetyCritical).map((c) => c.id)).toEqual([
      'evidencia-com-instrucao-embutida-habitos',
    ]);
  });
});

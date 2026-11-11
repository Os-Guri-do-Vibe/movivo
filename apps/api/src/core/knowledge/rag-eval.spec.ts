import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  applyFloor,
  goldenSetSchema,
  judgeQuestion,
  summarize,
  type GoldenQuestion,
} from './rag-eval';

const answerable: GoldenQuestion = {
  id: 'volume',
  question: 'quantas séries de peito por semana?',
  topic: 'TRAINING',
  expectAny: ['séries semanais'],
};
const outOfScope: GoldenQuestion = {
  id: 'fora',
  question: 'qual é a capital da França?',
  topic: 'GENERAL',
  expectNone: true,
};
const chunk = (text: string, cosine = 0.4, title = 'Documento') => ({ title, text, cosine });

describe('judgeQuestion', () => {
  it('acerta quando algum trecho tem o termo, sem diferenciar acento nem caixa', () => {
    const outcome = judgeQuestion(answerable, [
      chunk('Nada a ver.'),
      chunk('O VOLUME em SERIES SEMANAIS importa.', 0.31),
    ]);
    expect(outcome).toMatchObject({ kind: 'ANSWERABLE', hit: true, returned: 2, topCosine: 0.4 });
  });

  it('erra quando os trechos devolvidos não têm o que se esperava', () => {
    expect(judgeQuestion(answerable, [chunk('Fala só de creatina.')]).hit).toBe(false);
  });

  it('respondível que volta vazia não acerta', () => {
    expect(judgeQuestion(answerable, [])).toMatchObject({
      hit: false,
      returned: 0,
      topTitle: null,
    });
  });

  it('fora do assunto: calar é o certo, responder é erro', () => {
    expect(judgeQuestion(outOfScope, [])).toMatchObject({ kind: 'OUT_OF_SCOPE', abstained: true });
    expect(judgeQuestion(outOfScope, [chunk('qualquer coisa')]).abstained).toBe(false);
  });
});

describe('summarize', () => {
  it('conta recall, falsos vazios, abstenção e custo de contexto', () => {
    const summary = summarize([
      judgeQuestion(answerable, [chunk('séries semanais'), chunk('x')]),
      judgeQuestion({ ...answerable, id: 'b' }, [chunk('outra coisa')]),
      judgeQuestion({ ...answerable, id: 'c' }, []),
      judgeQuestion(outOfScope, []),
      judgeQuestion({ ...outOfScope, id: 'fora2' }, [chunk('ruído')]),
    ]);

    expect(summary).toMatchObject({
      answerable: 3,
      hits: 1,
      falseAbstentions: 1,
      outOfScope: 2,
      correctAbstentions: 1,
      abstentionRate: 0.5,
    });
    expect(summary.recall).toBeCloseTo(1 / 3);
    expect(summary.avgReturnedAnswerable).toBe(1);
  });

  it('conjunto vazio não divide por zero', () => {
    expect(summarize([])).toMatchObject({ recall: 0, abstentionRate: 0, avgReturnedAnswerable: 0 });
  });
});

describe('applyFloor', () => {
  it('mantém só o que tem similaridade igual ou acima do piso', () => {
    const kept = applyFloor([chunk('a', 0.5), chunk('b', 0.3), chunk('c', 0.25)], 0.3);
    expect(kept.map((item) => item.text)).toEqual(['a', 'b']);
  });
});

describe('conjunto de perguntas (assets/rag/golden-set.json)', () => {
  const raw = JSON.parse(
    readFileSync(resolve(process.cwd(), 'assets/rag/golden-set.json'), 'utf8'),
  );

  it('é válido e assume que ainda é rascunho até os profissionais validarem', () => {
    const set = goldenSetSchema.parse(raw);
    expect(set.status).toMatch(/RASCUNHO/);
  });

  it('cobre os domínios e inclui perguntas fora do assunto para medir a abstenção', () => {
    const { questions } = goldenSetSchema.parse(raw);
    const answerableCount = questions.filter((q) => q.expectAny).length;
    expect(answerableCount).toBeGreaterThanOrEqual(20);
    expect(questions.filter((q) => q.expectNone).length).toBeGreaterThanOrEqual(5);
    expect(new Set(questions.map((q) => q.topic))).toEqual(
      new Set(['TRAINING', 'NUTRITION', 'RECOVERY', 'HABITS', 'GENERAL']),
    );
  });

  it('recusa pergunta com expectAny e expectNone ao mesmo tempo, ou sem nenhum', () => {
    expect(goldenQuestionOk({ ...answerable, expectNone: true })).toBe(false);
    expect(
      goldenQuestionOk({ id: 'x', question: 'pergunta longa o bastante', topic: 'GENERAL' }),
    ).toBe(false);
  });

  it('recusa ids repetidos', () => {
    const q = { ...answerable };
    expect(goldenSetSchema.safeParse({ version: 1, status: 'x', questions: [q, q] }).success).toBe(
      false,
    );
  });
});

function goldenQuestionOk(question: unknown): boolean {
  return goldenSetSchema.safeParse({ version: 1, status: 'x', questions: [question] }).success;
}

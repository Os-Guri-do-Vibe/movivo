import type { ReviewSignal } from '@movivo/shared';
import { describe, expect, it, vi } from 'vitest';

import type { EvidenceChunk } from '../../core/knowledge/knowledge-retrieval.service';
import { collectEvidence, evidenceTopicsFor, mergeEvidence, SIGNAL_TOPIC } from './review-evidence';
import { HABITS_SIGNALS, RECOVERY_SIGNALS } from './review-signals';

const signal = (kind: ReviewSignal['kind']): ReviewSignal => ({
  key: kind.toLowerCase(),
  kind,
  // O detalhe traz número e dado reais do aluno: nada disso pode ir para a consulta.
  detail: 'Concluiu 1/4 das sessões. Sono 1/5. Peso 82,4 kg.',
});

const chunk = (id: string): EvidenceChunk => ({ id, title: 'Documento', text: `texto ${id}` });

describe('assuntos buscados pela revisão semanal', () => {
  it('cada sinal de hábitos e de recuperação tem um assunto fixo', () => {
    for (const kind of [...HABITS_SIGNALS, ...RECOVERY_SIGNALS]) {
      expect(SIGNAL_TOPIC[kind], kind).toBeTruthy();
    }
  });

  it('sinais de peso não buscam nada', () => {
    expect(SIGNAL_TOPIC.WEIGHT_PLATEAU).toBeUndefined();
    expect(SIGNAL_TOPIC.WEIGHT_WRONG_DIRECTION).toBeUndefined();
    expect(SIGNAL_TOPIC.WEIGHT_RAPID_CHANGE).toBeUndefined();
  });

  it('a consulta vem só dos rótulos: nenhum dado do aluno entra', () => {
    const topics = evidenceTopicsFor(
      [signal('ADHERENCE_LOW'), signal('BARRIER_REPORTED')],
      HABITS_SIGNALS,
    );
    const all = topics.join(' ');

    expect(topics).toHaveLength(2);
    expect(all).not.toMatch(/\d/);
    expect(all).not.toMatch(/kg|sono|concluiu/i);
  });

  it('só os sinais da área da leitura contam', () => {
    const signals = [signal('ADHERENCE_LOW'), signal('RECOVERY_LOW')];

    expect(evidenceTopicsFor(signals, HABITS_SIGNALS)).toEqual([SIGNAL_TOPIC.ADHERENCE_LOW]);
    expect(evidenceTopicsFor(signals, RECOVERY_SIGNALS)).toEqual([SIGNAL_TOPIC.RECOVERY_LOW]);
  });

  it('no máximo dois assuntos, sem repetição', () => {
    const topics = evidenceTopicsFor(
      [
        signal('ADHERENCE_LOW'),
        signal('ADHERENCE_LOW'),
        signal('KEY_SESSIONS_SKIPPED'),
        signal('BARRIER_REPORTED'),
      ],
      HABITS_SIGNALS,
    );

    expect(topics).toHaveLength(2);
    expect(new Set(topics).size).toBe(2);
  });
});

describe('mergeEvidence', () => {
  it('intercala os assuntos por posição, sem repetir trecho, até 3', () => {
    const merged = mergeEvidence([
      [chunk('a'), chunk('b'), chunk('c')],
      [chunk('a'), chunk('d')],
    ]);

    // 1ª posição: a (o repetido do 2º assunto cai); 2ª posição: b, d; o limite de 3 corta o c.
    expect(merged.map((c) => c.id)).toEqual(['a', 'b', 'd']);
  });

  it('cada assunto contribui com o seu melhor trecho antes de repetir um assunto', () => {
    const merged = mergeEvidence([
      [chunk('a'), chunk('b')],
      [chunk('c'), chunk('d')],
    ]);

    expect(merged.map((c) => c.id)).toEqual(['a', 'c', 'b']);
  });

  it('sem resultado devolve lista vazia', () => {
    expect(mergeEvidence([])).toEqual([]);
    expect(mergeEvidence([[], []])).toEqual([]);
  });
});

describe('collectEvidence', () => {
  it('sem serviço de busca, não há evidência', async () => {
    expect(await collectEvidence(null, [signal('ADHERENCE_LOW')], HABITS_SIGNALS)).toEqual([]);
  });

  it('sem sinal da área, nem chama a busca', async () => {
    const evidenceForTopic = vi.fn(async () => [chunk('a')]);

    expect(
      await collectEvidence({ evidenceForTopic }, [signal('LOAD_SPIKE')], HABITS_SIGNALS),
    ).toEqual([]);
    expect(evidenceForTopic).not.toHaveBeenCalled();
  });

  it('busca um assunto por sinal e junta o resultado', async () => {
    const evidenceForTopic = vi.fn(async (topic: string) =>
      topic === SIGNAL_TOPIC.ADHERENCE_LOW ? [chunk('a')] : [chunk('b')],
    );

    const found = await collectEvidence(
      { evidenceForTopic },
      [signal('ADHERENCE_LOW'), signal('BARRIER_REPORTED')],
      HABITS_SIGNALS,
    );

    expect(evidenceForTopic).toHaveBeenCalledTimes(2);
    expect(found.map((c) => c.id)).toEqual(['a', 'b']);
  });
});

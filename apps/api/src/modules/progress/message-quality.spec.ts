import { describe, expect, it } from 'vitest';

import { overallOf, qualityChecks, shouldJudge, similarity, verdictOf } from './message-quality';

describe('qualidade das mensagens dos agentes', () => {
  it('mede a repetição contra o que já foi dito', () => {
    const before = ['Vi que o sono andou curto esses dias. Como foi a noite de ontem?'];
    const same = qualityChecks({
      text: 'Vi que o sono andou curto esses dias. Como foi a noite de ontem?',
      firstName: 'Ana',
      previous: before,
    });
    expect(same.repeated).toBe(true);
    const fresh = qualityChecks({
      text: 'Ana, seu agachamento subiu 2,5 kg nesta semana. Quer tentar mais um pouco?',
      firstName: 'Ana',
      previous: before,
    });
    expect(fresh.repeated).toBe(false);
    expect(similarity('a b c d', 'a b c d')).toBe(0);
  });

  it('pega culpa, promessa e termo clínico', () => {
    const c = qualityChecks({
      text: 'Você sumiu de novo. Com esse plano o resultado é garantido, é só tratamento.',
      firstName: null,
      previous: [],
    });
    expect(c).toMatchObject({ guilt: true, promise: true, clinical: true });
    expect(verdictOf(c, null)).toBe('REVIEW');
  });

  it('mensagem sem nenhum ponto do aluno é marcada como possivelmente genérica', () => {
    expect(
      qualityChecks({
        text: 'Continue firme, você está indo muito bem!',
        firstName: 'Ana',
        previous: [],
      }).noAnchor,
    ).toBe(true);
    expect(
      qualityChecks({ text: 'Ana, 4 treinos nesta semana!', firstName: 'Ana', previous: [] })
        .noAnchor,
    ).toBe(false);
  });

  it('o juiz lê sempre o suspeito e uma amostra do resto', () => {
    const clean = qualityChecks({
      text: 'Ana, 4 treinos nesta semana!',
      firstName: 'Ana',
      previous: [],
    });
    expect(shouldJudge(clean, 0.5)).toBe(false);
    expect(shouldJudge(clean, 0.1)).toBe(true);
    const guilty = qualityChecks({ text: 'Você falhou de novo.', firstName: null, previous: [] });
    expect(shouldJudge(guilty, 0.99)).toBe(true);
  });

  it('veredito do juiz: média e nota mínima por critério', () => {
    const clean = qualityChecks({
      text: 'Ana, 4 treinos nesta semana!',
      firstName: 'Ana',
      previous: [],
    });
    const good = { specificity: 5, warmth: 4, clarity: 4, actionability: 4, safety: 5, novelty: 4 };
    expect(overallOf(good)).toBe(4.33);
    expect(verdictOf(clean, good)).toBe('OK');
    expect(verdictOf(clean, { ...good, specificity: 2 })).toBe('REVIEW');
    expect(
      verdictOf(clean, {
        ...good,
        specificity: 3,
        warmth: 3,
        clarity: 3,
        actionability: 3,
        novelty: 3,
      }),
    ).toBe('REVIEW');
  });
});

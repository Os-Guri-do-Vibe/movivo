import { describe, expect, it } from 'vitest';

import {
  CITATION_BAN_MESSAGE,
  citationViolations,
  citesSource,
  evidenceChunkSchema,
  evidenceListSchema,
} from './evidence-rules';

describe('evidenceChunkSchema / evidenceListSchema', () => {
  const chunk = (text: string) => ({ id: 'a', title: 'Documento', text });

  it('trecho vazio ou acima de 2.000 caracteres é recusado', () => {
    expect(evidenceChunkSchema.safeParse(chunk('x'.repeat(2_000))).success).toBe(true);
    expect(evidenceChunkSchema.safeParse(chunk('x'.repeat(2_001))).success).toBe(false);
    expect(evidenceChunkSchema.safeParse(chunk('')).success).toBe(false);
  });

  it('a lista é opcional e vai até 3 trechos', () => {
    expect(evidenceListSchema.safeParse(undefined).success).toBe(true);
    expect(evidenceListSchema.safeParse([chunk('a'), chunk('b'), chunk('c')]).success).toBe(true);
    expect(
      evidenceListSchema.safeParse([chunk('a'), chunk('b'), chunk('c'), chunk('d')]).success,
    ).toBe(false);
  });
});

describe('proibição de citar a fonte', () => {
  it.each([
    'Segundo um estudo recente, o sono ajuda.',
    'De acordo com a pesquisa, 3 séries bastam.',
    'Estudos mostram que descansar ajuda.',
    'Isso aparece em Currier et al. e funciona.',
    'Veja em https://exemplo.com/artigo',
    'A meta-análise indica que sim.',
    'Conforme a ciência, o descanso importa.',
  ])('recusa: %s', (text) => {
    expect(citesSource(text)).toBe(true);
    expect(citationViolations(text, 'reply')).toEqual([
      { path: 'reply', message: CITATION_BAN_MESSAGE },
    ]);
  });

  it.each([
    'Deixar 1 a 3 repetições sobrando costuma bastar.',
    'Que tal começar com uma sessão curta de 20 minutos?',
    'Uma noite ruim isolada não obriga a cancelar o treino.',
  ])('aceita: %s', (text) => {
    expect(citesSource(text)).toBe(false);
    expect(citationViolations(text, 'reply')).toEqual([]);
  });
});

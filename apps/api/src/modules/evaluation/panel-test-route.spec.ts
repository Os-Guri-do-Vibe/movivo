/** Sem chamar modelo: só confere qual rota os testes do painel escolhem e quanto ela custa. */
import { describe, expect, it } from 'vitest';

import { costBrl } from '../../core/ai/pricing';
import { EvaluationService } from './evaluation.service';

const config = {
  llm: {
    primaryModel: 'deepseek-v4-pro',
    fallbackModel: 'gpt-6.1-sol',
    secondaryFallbackModel: 'claude-sonnet-5-5',
    evalModel: 'deepseek-flash',
  },
};

function build(tier: string, cfg: unknown = config) {
  const registry = { get: () => ({ task: { tier } }) };
  return new EvaluationService(registry as never, {} as never, {} as never, cfg as never, null);
}

describe('rota dos testes do painel', () => {
  it.each(['FAST', 'STANDARD', 'REASONING'])(
    'tier %s usa só o DeepSeek barato, em uma única rota (sem failover)',
    (tier) => {
      const route = build(tier).panelTestRoute('qualquer.tarefa');
      expect(route).toMatchObject({ vendor: 'DEEPSEEK', model: 'deepseek-flash', vision: false });
      expect(route?.maxOutputTokens).toBeGreaterThan(0);
    },
  );

  it('tarefa de imagem segue a rota configurada (DeepSeek não lê imagem)', () => {
    expect(build('VISION').panelTestRoute('x')).toBeUndefined();
  });

  it('o modelo de teste é o configurado', () => {
    expect(build('STANDARD').panelTestModel()).toBe('deepseek-flash');
  });

  it('se a configuração não chegar, o boot falha em vez de usar modelo caro em silêncio', () => {
    expect(() => build('STANDARD', null).onModuleInit()).toThrow(/modelo dos testes/);
    expect(() => build('STANDARD').onModuleInit()).not.toThrow();
  });

  it('o modelo barato tem preço próprio: custa muito menos que o preço-padrão', () => {
    const usage = { tokensInput: 100_000, tokensCached: 0, tokensOutput: 20_000 };
    const cheap = costBrl('deepseek-flash', usage, 5.5);
    const unknown = costBrl('modelo-sem-preco', usage, 5.5);
    expect(cheap).toBeGreaterThan(0);
    expect(cheap).toBeLessThan(unknown / 5);
  });
});

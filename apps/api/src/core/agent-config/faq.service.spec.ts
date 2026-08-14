import { describe, expect, it, vi } from 'vitest';

import type { DrizzleClient } from '../database/database.module';
import { FaqService, normalizeFaqQuestion } from './faq.service';

describe('normalizeFaqQuestion', () => {
  it.each([
    ['Posso treinar em casa?', 'posso treinar em casa'],
    ['  POSSO   treinar  em CASA!! ', 'posso treinar em casa'],
    ['Posso treinár em casa.', 'posso treinar em casa'],
  ])('%s normaliza para a mesma chave determinística', (input, expected) => {
    expect(normalizeFaqQuestion(input)).toBe(expected);
  });
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    faqKey: '22222222-2222-4222-8222-222222222222',
    normalizedQuestion: 'posso treinar em casa',
    answer: 'Sim, o protocolo do profissional CREF adapta os exercicios.',
    version: 2,
    status: 'PUBLISHED',
    ...overrides,
  };
}

function faqWith(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    from: () => chain,
    orderBy: vi.fn(async () => rows),
  };
  const select = vi.fn(() => chain);
  const service = new FaqService({ select } as unknown as DrizzleClient);
  return { service, select, orderBy: chain.orderBy as ReturnType<typeof vi.fn> };
}

describe('FaqService.currentEntries', () => {
  it('indexa apenas a versão mais recente de cada faqKey', async () => {
    const { service } = faqWith([
      row({ id: 'nova', version: 3 }),
      row({ id: 'antiga', version: 1, answer: 'resposta velha' }),
    ]);

    const entries = await service.currentEntries();

    expect(entries.size).toBe(1);
    expect(entries.get('posso treinar em casa')).toMatchObject({ id: 'nova', version: 3 });
  });

  it('FAQ retirado sai do índice — e não reexpõe a versão publicada anterior', async () => {
    const { service } = faqWith([
      row({ id: 'retirada', version: 4, status: 'RETIRED' }),
      row({ id: 'publicada', version: 3 }),
    ]);

    await expect(service.currentEntries()).resolves.toHaveProperty('size', 0);
  });

  it('serve do cache dentro da janela e volta ao banco depois de invalidar', async () => {
    const { service, select } = faqWith([row()]);

    await service.currentEntries();
    await service.currentEntries();
    expect(select).toHaveBeenCalledOnce();

    service.invalidate();
    await service.currentEntries();
    expect(select).toHaveBeenCalledTimes(2);
  });

  it('o cache expira sozinho depois da janela curta', async () => {
    const { service, select } = faqWith([row()]);
    vi.useFakeTimers();
    try {
      await service.currentEntries();
      vi.setSystemTime(Date.now() + 61_000);
      await service.currentEntries();
    } finally {
      vi.useRealTimers();
    }
    expect(select).toHaveBeenCalledTimes(2);
  });
});

describe('FaqService.match', () => {
  it('casa a pergunta do aluno pela forma normalizada, com acento e pontuação livres', async () => {
    const { service } = faqWith([row()]);
    await expect(service.match('  Posso TREINAR em casá? ')).resolves.toMatchObject({
      id: '11111111-1111-4111-8111-111111111111',
      version: 2,
    });
  });

  it('devolve null quando nenhuma entrada publicada corresponde', async () => {
    const { service } = faqWith([row()]);
    await expect(service.match('quanto custa o plano anual')).resolves.toBeNull();
  });
});

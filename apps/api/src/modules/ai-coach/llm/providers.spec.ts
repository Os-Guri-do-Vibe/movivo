/**
 * Unit — adaptadores de provedor (US-2.2). `fetch` mockado (sem rede): classificação de
 * erro (429/5xx/4xx/rede/abort), NO_CREDENTIALS sem chave e normalização de tokens/cache.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AnthropicProvider, OpenAiProvider } from './providers';
import { LLMProviderError, type ProviderCompleteRequest } from './llm.types';

const REQ: ProviderCompleteRequest = {
  system: 'system',
  messages: [{ role: 'user', content: 'oi' }],
  maxTokens: 100,
  temperature: 0.4,
  cache: true,
};

function signal(): AbortSignal {
  return new AbortController().signal;
}

function mockFetch(impl: () => Promise<Partial<Response>>): void {
  vi.stubGlobal('fetch', vi.fn(impl));
}

afterEach(() => vi.unstubAllGlobals());

describe('OpenAiProvider', () => {
  it('lança NO_CREDENTIALS sem chave e não chama fetch', async () => {
    const p = new OpenAiProvider('OPENAI_GPT41', 'gpt-4.1', undefined);
    expect(p.hasCredentials()).toBe(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(p.complete(REQ, signal())).rejects.toMatchObject({ kind: 'NO_CREDENTIALS' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('normaliza tokens (input fresco = prompt - cached)', async () => {
    mockFetch(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: 'treino' } }],
            usage: {
              prompt_tokens: 1000,
              completion_tokens: 200,
              prompt_tokens_details: { cached_tokens: 400 },
            },
          }),
      } as Partial<Response>),
    );
    const p = new OpenAiProvider('OPENAI_GPT41', 'gpt-4.1', 'sk-test');
    const r = await p.complete(REQ, signal());
    expect(r.text).toBe('treino');
    expect(r.usage).toEqual({ tokensInput: 600, tokensCached: 400, tokensOutput: 200 });
  });

  it.each([
    [429, 'RATE_LIMIT'],
    [503, 'SERVER'],
    [400, 'CLIENT'],
  ])('classifica status %i como %s', async (status, kind) => {
    mockFetch(() =>
      Promise.resolve({
        ok: false,
        status,
        text: () => Promise.resolve('erro'),
      } as Partial<Response>),
    );
    const p = new OpenAiProvider('OPENAI_GPT41', 'gpt-4.1', 'sk-test');
    await expect(p.complete(REQ, signal())).rejects.toMatchObject({ kind });
  });

  it('mapeia erro de rede como TRANSIENT e abort como TIMEOUT', async () => {
    mockFetch(() => Promise.reject(new Error('ECONNRESET')));
    const p = new OpenAiProvider('OPENAI_GPT41', 'gpt-4.1', 'sk-test');
    await expect(p.complete(REQ, signal())).rejects.toMatchObject({ kind: 'TRANSIENT' });

    mockFetch(() => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    await expect(p.complete(REQ, signal())).rejects.toMatchObject({ kind: 'TIMEOUT' });
  });
});

describe('AnthropicProvider', () => {
  it('lança NO_CREDENTIALS sem chave', async () => {
    const p = new AnthropicProvider('ANTHROPIC_SONNET45', 'claude-sonnet-4-5', undefined);
    await expect(p.complete(REQ, signal())).rejects.toBeInstanceOf(LLMProviderError);
  });

  it('normaliza tokens (input já exclui cache read)', async () => {
    mockFetch(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            content: [{ type: 'text', text: 'treino' }],
            usage: { input_tokens: 600, output_tokens: 200, cache_read_input_tokens: 400 },
          }),
      } as Partial<Response>),
    );
    const p = new AnthropicProvider('ANTHROPIC_SONNET45', 'claude-sonnet-4-5', 'sk-ant');
    const r = await p.complete(REQ, signal());
    expect(r.text).toBe('treino');
    expect(r.usage).toEqual({ tokensInput: 600, tokensCached: 400, tokensOutput: 200 });
  });

  it('classifica 500 como SERVER', async () => {
    mockFetch(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        text: () => Promise.resolve('x'),
      } as Partial<Response>),
    );
    const p = new AnthropicProvider('ANTHROPIC_SONNET45', 'claude-sonnet-4-5', 'sk-ant');
    await expect(p.complete(REQ, signal())).rejects.toMatchObject({ kind: 'SERVER' });
  });
});

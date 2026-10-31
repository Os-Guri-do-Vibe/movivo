import { describe, expect, it, vi } from 'vitest';

import { AnthropicVendor, classifyStatus, OpenAiVendor } from './vendors';

describe('classifyStatus', () => {
  it('conta sem saldo na Anthropic (400) faz failover em vez de abortar', () => {
    const body =
      '{"error":{"message":"Your credit balance is too low to access the Anthropic API."}}';
    expect(classifyStatus('ANTHROPIC', 400, body).kind).toBe('AUTH');
  });

  it('429 por saldo esgotado é falha da conta; 429 comum segue sendo limite de ritmo', () => {
    expect(classifyStatus('OPENAI', 429, '{"error":{"code":"insufficient_quota"}}').kind).toBe(
      'AUTH',
    );
    expect(classifyStatus('OPENAI', 429, '{"error":{"code":"rate_limit_exceeded"}}').kind).toBe(
      'RATE_LIMIT',
    );
  });

  it('400 comum continua sendo erro do pedido', () => {
    expect(classifyStatus('OPENAI', 400, '{"error":{"message":"invalid schema"}}').kind).toBe(
      'CLIENT',
    );
  });

  it('classifica os demais status', () => {
    expect(classifyStatus('OPENAI', 429, '').kind).toBe('RATE_LIMIT');
    expect(classifyStatus('DEEPSEEK', 402, '').kind).toBe('AUTH');
    expect(classifyStatus('OPENAI', 503, '').kind).toBe('SERVER');
  });
});

describe('PDF no corpo do pedido', () => {
  const pdf = {
    type: 'document' as const,
    mediaType: 'application/pdf' as const,
    base64: 'JVBERi0=',
    fileName: 'exame.pdf',
  };
  const request = {
    model: 'm',
    system: 's',
    messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 't' }, pdf] }],
    maxOutputTokens: 10,
    temperature: 0,
    json: true,
  };

  async function bodyOf(vendor: OpenAiVendor | AnthropicVendor): Promise<string> {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ choices: [], content: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await vendor.complete(request, new AbortController().signal);
    vi.unstubAllGlobals();
    return String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body);
  }

  it('OpenAI recebe parte file com data URL; Anthropic recebe bloco document', async () => {
    expect(await bodyOf(new OpenAiVendor('k', true))).toContain(
      '"type":"file","file":{"filename":"exame.pdf","file_data":"data:application/pdf;base64,JVBERi0="}',
    );
    expect(await bodyOf(new AnthropicVendor('k', true))).toContain(
      '"type":"document","source":{"type":"base64","media_type":"application/pdf","data":"JVBERi0="}',
    );
  });
});

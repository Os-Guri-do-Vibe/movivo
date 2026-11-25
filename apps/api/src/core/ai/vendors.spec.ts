import { describe, expect, it, vi } from 'vitest';

import { AnthropicVendor, classifyStatus, DeepSeekVendor, OpenAiVendor } from './vendors';

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
  const request = (model: string) => ({
    model,
    system: 's',
    messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 't' }, pdf] }],
    maxOutputTokens: 10,
    temperature: 0,
    json: true,
  });

  async function bodyOf(
    vendor: OpenAiVendor | AnthropicVendor,
    model: string,
  ): Promise<Record<string, unknown>> {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ choices: [], content: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await vendor.complete(request(model), new AbortController().signal);
    const body = JSON.parse(
      String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    ) as { messages?: unknown[]; temperature?: number };
    vi.unstubAllGlobals();
    return body;
  }

  it('envia PDF nos formatos de cada fornecedor e omite temperature nos modelos de raciocínio', async () => {
    const openAi = await bodyOf(new OpenAiVendor('k', true), 'gpt-6.1-sol');
    expect(openAi.temperature).toBeUndefined();
    expect(JSON.stringify(openAi.messages)).toContain(
      '"type":"file","file":{"filename":"exame.pdf","file_data":"data:application/pdf;base64,JVBERi0="}',
    );

    const anthropic = await bodyOf(new AnthropicVendor('k', true), 'claude-sonnet-5-5');
    expect(anthropic.temperature).toBeUndefined();
    expect(JSON.stringify(anthropic.messages)).toContain(
      '"type":"document","source":{"type":"base64","media_type":"application/pdf","data":"JVBERi0="}',
    );
  });

  it('mantém temperature nos modelos que aceitam esse parâmetro', async () => {
    expect((await bodyOf(new OpenAiVendor('k', true), 'gpt-4.1')).temperature).toBe(0);
    expect((await bodyOf(new AnthropicVendor('k', true), 'claude-sonnet-4-5')).temperature).toBe(0);
  });
});

describe('DeepSeek: raciocínio (thinking)', () => {
  async function deepSeekBody(reasoningEffort?: 'low' | 'high' | 'max') {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await new DeepSeekVendor('k', true).complete(
      {
        model: 'deepseek-v4-pro',
        system: 's',
        messages: [{ role: 'user', content: 't' }],
        maxOutputTokens: 48_000,
        temperature: 0.3,
        json: true,
        ...(reasoningEffort ? { reasoningEffort } : {}),
      },
      new AbortController().signal,
    );
    const body = JSON.parse(
      String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    ) as Record<string, unknown>;
    vi.unstubAllGlobals();
    return body;
  }

  it('desligado por padrão, com temperature', async () => {
    const body = await deepSeekBody();
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.temperature).toBe(0.3);
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('com esforço: liga o thinking, manda o esforço e omite temperature', async () => {
    const body = await deepSeekBody('high');
    expect(body.thinking).toEqual({ type: 'enabled' });
    expect(body.reasoning_effort).toBe('high');
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBe(48_000);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });
});

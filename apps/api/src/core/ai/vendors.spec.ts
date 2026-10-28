import { describe, expect, it } from 'vitest';

import { classifyStatus } from './vendors';

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

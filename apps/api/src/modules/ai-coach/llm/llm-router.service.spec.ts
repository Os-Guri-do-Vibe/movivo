/**
 * Unit — LLMRouter (US-2.2 / TASK-2.2.2/2.2.3). Providers injetados como fakes (sem rede):
 * cascata, failover <2s (5xx/429/timeout), circuit breaker, retry transitório, teto de
 * tokens, `default=HEALTH`, PII scrubber inescapável e logging em ai_jobs.
 */
import { describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../../../core/config';
import type { PinoLogger } from 'nestjs-pino';
import type { AiJobRepository } from './ai-job.repository';
import type { LlmAbuseGuard } from './llm-abuse-guard.service';
import { costBrl, LlmRouter } from './llm-router.service';
import {
  type LLMProvider,
  LLMProviderError,
  type LLMRequest,
  LLMUnavailableError,
  type ProviderCompleteRequest,
  type ProviderName,
  type ProviderResult,
} from './llm.types';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function usage(): ProviderResult['usage'] {
  return { tokensInput: 1000, tokensCached: 500, tokensOutput: 200 };
}

class FakeProvider implements LLMProvider {
  complete: (req: ProviderCompleteRequest, signal: AbortSignal) => Promise<ProviderResult>;
  constructor(
    readonly name: ProviderName,
    readonly model: string,
    impl: (req: ProviderCompleteRequest, signal: AbortSignal) => Promise<ProviderResult>,
    private readonly creds = true,
    private readonly healthApproved = true,
  ) {
    this.complete = vi.fn(impl);
  }
  hasCredentials(): boolean {
    return this.creds;
  }
  canProcess(dataClass: 'HEALTH' | 'NON_HEALTH'): boolean {
    return dataClass === 'NON_HEALTH' || this.healthApproved;
  }
}

function ok(model: string): () => Promise<ProviderResult> {
  return () => Promise.resolve({ text: 'treino', model, usage: usage() });
}

function make(providers: LLMProvider[]) {
  const aiJobs = { record: vi.fn().mockResolvedValue(undefined) } as unknown as AiJobRepository;
  const abuse = {
    check: vi.fn().mockResolvedValue(undefined),
    recordCost: vi.fn().mockResolvedValue(undefined),
  } as unknown as LlmAbuseGuard;
  const config = {
    llm: {
      maxTokens: 4096,
      timeoutMs: 8000,
      protocolTimeoutMs: 45_000,
      usdBrlRate: 5.5,
      userDailyMessageLimit: 50,
      dailyCostAlertBrl: 0.5,
    },
  } as unknown as AppConfigService;
  const logger = { setContext: vi.fn(), warn: vi.fn(), info: vi.fn() } as unknown as PinoLogger;
  const router = new LlmRouter(providers, aiJobs, abuse, config, logger);
  return { router, aiJobs, abuse, config };
}

function request(over: Partial<LLMRequest> = {}): LLMRequest {
  return {
    purpose: 'PROTOCOL_GENERATION',
    userId: USER_ID,
    user: { name: 'João', phoneNumber: '+5511999998888' },
    system: 'system CREF',
    messages: [{ role: 'user', content: 'quero treinar' }],
    ...over,
  };
}

describe('LlmRouter.complete', () => {
  it('serve pelo primário (attempt 1) e grava ai_jobs COMPLETED com custo', async () => {
    const primary = new FakeProvider('OPENAI_GPT41', 'gpt-4.1', ok('gpt-4.1'));
    const fallback = new FakeProvider('ANTHROPIC_SONNET45', 'claude-sonnet-4-5', ok('x'));
    const { router, aiJobs, abuse } = make([primary, fallback]);

    const result = await router.complete(request());

    expect(result.attempt).toBe(1);
    expect(result.provider).toBe('OPENAI_GPT41');
    expect(result.dataClass).toBe('HEALTH');
    expect(result.costBrl).toBeGreaterThan(0);
    expect(fallback.complete).not.toHaveBeenCalled();
    expect(abuse.check).toHaveBeenCalledWith(USER_ID, undefined);
    expect(abuse.recordCost).toHaveBeenCalled();
    expect(aiJobs.record).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ status: 'COMPLETED', provider: 'OPENAI_GPT41', attempt: 1 }),
    );
  });

  it('faz failover <2s em 5xx do primário', async () => {
    const primary = new FakeProvider('OPENAI_GPT41', 'gpt-4.1', () =>
      Promise.reject(new LLMProviderError('SERVER', 'OPENAI_GPT41', '500')),
    );
    const fallback = new FakeProvider(
      'ANTHROPIC_SONNET45',
      'claude-sonnet-4-5',
      ok('claude-sonnet-4-5'),
    );
    const { router } = make([primary, fallback]);

    const t = Date.now();
    const result = await router.complete(request());
    expect(Date.now() - t).toBeLessThan(2000);
    expect(result.attempt).toBe(2);
    expect(result.provider).toBe('ANTHROPIC_SONNET45');
  });

  it('failover em 429 sem retry no primário', async () => {
    const primary = new FakeProvider('OPENAI_GPT41', 'gpt-4.1', () =>
      Promise.reject(new LLMProviderError('RATE_LIMIT', 'OPENAI_GPT41', '429')),
    );
    const fallback = new FakeProvider(
      'ANTHROPIC_SONNET45',
      'claude-sonnet-4-5',
      ok('claude-sonnet-4-5'),
    );
    const { router } = make([primary, fallback]);

    await router.complete(request());
    expect(primary.complete).toHaveBeenCalledTimes(1); // sem retry em 429
  });

  function timeoutProvider(): FakeProvider {
    return new FakeProvider(
      'OPENAI_GPT41',
      'gpt-4.1',
      (_req, signal) =>
        new Promise<ProviderResult>((_res, rej) => {
          signal.addEventListener('abort', () =>
            rej(new LLMProviderError('TIMEOUT', 'OPENAI_GPT41', 'timeout')),
          );
        }),
    );
  }

  it('timeout hard dispara failover', async () => {
    const primary = timeoutProvider();
    const fallback = new FakeProvider(
      'ANTHROPIC_SONNET45',
      'claude-sonnet-4-5',
      ok('claude-sonnet-4-5'),
    );
    const { router, config } = make([primary, fallback]);
    // `request()` default é PROTOCOL_GENERATION — usa `protocolTimeoutMs`, não `timeoutMs`.
    (config.llm as { protocolTimeoutMs: number }).protocolTimeoutMs = 50;

    const result = await router.complete(request());
    expect(result.attempt).toBe(2);
  });

  it('PROTOCOL_GENERATION usa o timeout dedicado (job em fila); AI_RESPONSE usa o do chat (achado 2026-08-18)', async () => {
    const primary = timeoutProvider();
    const fallback = new FakeProvider(
      'ANTHROPIC_SONNET45',
      'claude-sonnet-4-5',
      ok('claude-sonnet-4-5'),
    );
    const { router, config } = make([primary, fallback]);
    (config.llm as { timeoutMs: number; protocolTimeoutMs: number }).timeoutMs = 50;
    (config.llm as { protocolTimeoutMs: number }).protocolTimeoutMs = 24 * 60 * 60 * 1000; // 1 dia — nunca estoura no teste

    // AI_RESPONSE: usa o timeout curto do chat (50ms) — estoura e cai pro fallback.
    const chatResult = await router.complete(request({ purpose: 'AI_RESPONSE' }));
    expect(chatResult.attempt).toBe(2);
    expect(chatResult.provider).toBe('ANTHROPIC_SONNET45');
  });

  it('1 retry no mesmo provedor para erro de rede transitório', async () => {
    let calls = 0;
    const primary = new FakeProvider('OPENAI_GPT41', 'gpt-4.1', () => {
      calls += 1;
      if (calls === 1)
        return Promise.reject(new LLMProviderError('TRANSIENT', 'OPENAI_GPT41', 'net'));
      return Promise.resolve({ text: 'ok', model: 'gpt-4.1', usage: usage() });
    });
    const { router } = make([primary, new FakeProvider('ANTHROPIC_SONNET45', 'x', ok('x'))]);

    const result = await router.complete(request());
    expect(calls).toBe(2);
    expect(result.attempt).toBe(1);
  });

  it('erro 4xx (CLIENT) aborta sem failover e grava FAILED', async () => {
    const primary = new FakeProvider('OPENAI_GPT41', 'gpt-4.1', () =>
      Promise.reject(new LLMProviderError('CLIENT', 'OPENAI_GPT41', '400')),
    );
    const fallback = new FakeProvider('ANTHROPIC_SONNET45', 'x', ok('x'));
    const { router, aiJobs } = make([primary, fallback]);

    await expect(router.complete(request())).rejects.toBeInstanceOf(LLMProviderError);
    expect(fallback.complete).not.toHaveBeenCalled();
    expect(aiJobs.record).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ status: 'FAILED' }),
    );
  });

  it('todos os provedores falham → LLMUnavailableError + ai_jobs FAILED', async () => {
    const fail = (n: ProviderName) => () =>
      Promise.reject(new LLMProviderError('SERVER', n, '500'));
    const primary = new FakeProvider('OPENAI_GPT41', 'gpt-4.1', fail('OPENAI_GPT41'));
    const fallback = new FakeProvider('ANTHROPIC_SONNET45', 'x', fail('ANTHROPIC_SONNET45'));
    const { router, aiJobs } = make([primary, fallback]);

    await expect(router.complete(request())).rejects.toBeInstanceOf(LLMUnavailableError);
    expect(aiJobs.record).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ status: 'FAILED' }),
    );
  });

  it('sem chave (NO_CREDENTIALS) no primário faz failover', async () => {
    const primary = new FakeProvider(
      'OPENAI_GPT41',
      'gpt-4.1',
      () => Promise.reject(new LLMProviderError('NO_CREDENTIALS', 'OPENAI_GPT41', 'sem chave')),
      false,
    );
    const fallback = new FakeProvider(
      'ANTHROPIC_SONNET45',
      'claude-sonnet-4-5',
      ok('claude-sonnet-4-5'),
    );
    const { router } = make([primary, fallback]);

    const result = await router.complete(request());
    expect(result.provider).toBe('ANTHROPIC_SONNET45');
  });

  it('respeita default=HEALTH e o override NON_HEALTH', async () => {
    const { router } = make([new FakeProvider('OPENAI_GPT41', 'gpt-4.1', ok('gpt-4.1'))]);
    expect((await router.complete(request())).dataClass).toBe('HEALTH');
    expect((await router.complete(request({ dataClass: 'NON_HEALTH' }))).dataClass).toBe(
      'NON_HEALTH',
    );
  });

  it('não chama provedor sem aprovação HEALTH e segue para o próximo aprovado', async () => {
    const blocked = new FakeProvider(
      'DEEPSEEK_V4_PRO',
      'deepseek-v4-pro',
      ok('deepseek-v4-pro'),
      true,
      false,
    );
    const approved = new FakeProvider('OPENAI_GPT41', 'gpt-4.1', ok('gpt-4.1'));
    const { router } = make([blocked, approved]);

    const result = await router.complete(request());

    expect(blocked.complete).not.toHaveBeenCalled();
    expect(result.provider).toBe('OPENAI_GPT41');
    expect(result.attempt).toBe(2);
  });

  it('sem maxTokens no request, usa o default do config', async () => {
    let seen: ProviderCompleteRequest | undefined;
    const primary = new FakeProvider('OPENAI_GPT41', 'gpt-4.1', (req) => {
      seen = req;
      return Promise.resolve({ text: 'ok', model: 'gpt-4.1', usage: usage() });
    });
    const { router } = make([primary]);
    await router.complete(request({ maxTokens: undefined }));
    expect(seen?.maxTokens).toBe(4096);
  });

  // Achado 2026-09-02: `Math.min(request.maxTokens ?? cfg.maxTokens, cfg.maxTokens)` clampava
  // TODO caller de volta ao teto genérico de chat, mesmo quando o caller (ex: geração de
  // protocolo) pedia de propósito um teto maior — protocolo real truncava aos 4096 tokens e
  // caía em retry/fallback sempre. `maxTokens` explícito do request nunca é controlado por
  // usuário final (só por código interno com valor fixo calibrado por propósito) — o router
  // deve honrar, não sobrepor.
  it('com maxTokens explícito no request (ex: protocolMaxTokens), honra o valor pedido', async () => {
    let seen: ProviderCompleteRequest | undefined;
    const primary = new FakeProvider('OPENAI_GPT41', 'gpt-4.1', (req) => {
      seen = req;
      return Promise.resolve({ text: 'ok', model: 'gpt-4.1', usage: usage() });
    });
    const { router } = make([primary]);
    await router.complete(request({ maxTokens: 6000 }));
    expect(seen?.maxTokens).toBe(6000);
  });

  it('pseudonimiza system e messages antes de enviar ao provedor (scrubber inescapável)', async () => {
    let seen: ProviderCompleteRequest | undefined;
    const primary = new FakeProvider('OPENAI_GPT41', 'gpt-4.1', (req) => {
      seen = req;
      return Promise.resolve({ text: 'ok', model: 'gpt-4.1', usage: usage() });
    });
    const { router } = make([primary]);
    await router.complete(
      request({
        system: 'Olá João',
        messages: [{ role: 'user', content: 'meu tel +5511999998888' }],
      }),
    );
    expect(seen?.system).not.toContain('João');
    expect(seen?.messages[0]?.content).not.toContain('+5511999998888');
  });

  it('audita somente hashes e contagens, sem duplicar prompt ou dado de saúde', async () => {
    const primary = new FakeProvider('OPENAI_GPT41', 'gpt-4.1', ok('gpt-4.1'));
    const { router, aiJobs } = make([primary]);
    await router.complete(
      request({
        system: 'regra operacional secreta',
        messages: [{ role: 'user', content: 'dor persistente no joelho' }],
      }),
    );

    const snapshot = String(
      (aiJobs.record as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]?.inputSnapshot,
    );
    expect(snapshot).not.toContain('regra operacional secreta');
    expect(snapshot).not.toContain('dor persistente');
    expect(JSON.parse(snapshot)).toMatchObject({
      version: 2,
      systemSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      messagesSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      messageCount: 1,
    });
  });

  it('persiste somente código de erro, sem detalhes retornados pelo provedor', async () => {
    const provider = new FakeProvider('OPENAI_GPT41', 'gpt-4.1', () =>
      Promise.reject(
        new LLMProviderError('CLIENT', 'OPENAI_GPT41', 'conteúdo sensível devolvido no erro'),
      ),
    );
    const { router, aiJobs } = make([provider]);

    await expect(router.complete(request())).rejects.toBeInstanceOf(LLMProviderError);
    expect(aiJobs.record).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ errorMessage: 'LLM_PROVIDER_CLIENT' }),
    );
  });

  it('abre o breaker após 5 falhas e pula o primário na 6ª chamada', async () => {
    const primary = new FakeProvider('OPENAI_GPT41', 'gpt-4.1', () =>
      Promise.reject(new LLMProviderError('SERVER', 'OPENAI_GPT41', '500')),
    );
    const fallback = new FakeProvider(
      'ANTHROPIC_SONNET45',
      'claude-sonnet-4-5',
      ok('claude-sonnet-4-5'),
    );
    const { router } = make([primary, fallback]);

    for (let i = 0; i < 6; i++) await router.complete(request());
    // 5 falhas abriram o breaker; a 6ª chamada não toca o primário.
    expect(primary.complete).toHaveBeenCalledTimes(5);
  });
});

describe('costBrl', () => {
  it('calcula o custo em BRL a partir do pricing e do câmbio', () => {
    // gpt-4.1: input 2/M, cached 0.5/M, output 8/M · fx 5.5
    const cost = costBrl(
      'gpt-4.1',
      { tokensInput: 1_000_000, tokensCached: 0, tokensOutput: 0 },
      5.5,
    );
    expect(cost).toBeCloseTo(2 * 5.5, 5);
  });
});

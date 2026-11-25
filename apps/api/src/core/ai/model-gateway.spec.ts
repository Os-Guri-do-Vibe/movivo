import { describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../config';
import {
  type DataClass,
  type GatewayRequest,
  type ModelVendor,
  type ModelVendorClient,
  type TierRoute,
  TierUnavailableError,
  type VendorRequest,
  type VendorResult,
  VendorError,
} from './ai.types';
import { ModelGateway, type ModelRunRecord, type ModelRunRecorder } from './model-gateway';
import type { ModelTierConfig } from './model-tier-config';

class FakeVendor implements ModelVendorClient {
  readonly calls: VendorRequest[] = [];
  constructor(
    readonly vendor: ModelVendor,
    private readonly behavior: (call: number) => VendorResult | Error,
    private readonly opts: { health?: boolean; key?: boolean } = {},
  ) {}
  hasCredentials() {
    return this.opts.key ?? true;
  }
  canProcess(dataClass: DataClass) {
    return dataClass === 'NON_HEALTH' || (this.opts.health ?? true);
  }
  async complete(request: VendorRequest): Promise<VendorResult> {
    this.calls.push(request);
    const outcome = this.behavior(this.calls.length);
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }
}

const ok = (text: string): VendorResult => ({
  text,
  usage: { tokensInput: 100, tokensCached: 0, tokensOutput: 50 },
});

const route = (vendor: ModelVendor, model: string, vision = false): TierRoute => ({
  vendor,
  model,
  maxOutputTokens: 1_000,
  timeoutMs: 1_000,
  temperature: 0.2,
  vision,
});

function setup(vendors: FakeVendor[], routes: TierRoute[]) {
  const runs: ModelRunRecord[] = [];
  const recorder = {
    record: vi.fn(async (run: ModelRunRecord) => {
      runs.push(run);
      return `run-${runs.length}`;
    }),
  } as unknown as ModelRunRecorder;
  const tiers = { routesFor: vi.fn(async () => routes) } as unknown as ModelTierConfig;
  const config = { llm: { usdBrlRate: 5 } } as unknown as AppConfigService;
  const logger = { setContext: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  const gateway = new ModelGateway(vendors, tiers, recorder, config, logger as never);
  return { gateway, runs };
}

const request: GatewayRequest = {
  tier: 'STANDARD',
  taskId: 'teste.tarefa',
  promptVersion: 'abc123',
  userId: '11111111-1111-4111-8111-111111111111',
  scrubUser: { name: 'Maria Souza', phoneNumber: '+5511988887777' },
  system: 'Você é um especialista.',
  messages: [{ role: 'user', content: 'Sou a Maria Souza, meu telefone é +5511988887777' }],
  json: true,
};

describe('ModelGateway', () => {
  it('usa a primeira rota saudável e registra custo, tokens e versão do prompt', async () => {
    const deepseek = new FakeVendor('DEEPSEEK', () => ok('{"ok":true}'));
    const { gateway, runs } = setup([deepseek], [route('DEEPSEEK', 'deepseek-v4-pro')]);
    const result = await gateway.complete(request);
    expect(result).toMatchObject({ text: '{"ok":true}', vendor: 'DEEPSEEK', modelRunId: 'run-1' });
    expect(runs[0]).toMatchObject({
      status: 'COMPLETED',
      taskId: 'teste.tarefa',
      promptVersion: 'abc123',
      tokensInput: 100,
      tokensOutput: 50,
    });
    expect(runs[0]?.costBrl).toBeGreaterThan(0);
  });

  it('pseudonimiza a mensagem antes de sair e não guarda o conteúdo no registro', async () => {
    const deepseek = new FakeVendor('DEEPSEEK', () => ok('{}'));
    const { gateway, runs } = setup([deepseek], [route('DEEPSEEK', 'm')]);
    await gateway.complete(request);
    const sent = JSON.stringify(deepseek.calls[0]?.messages);
    expect(sent).not.toContain('Maria Souza');
    expect(sent).not.toContain('988887777');
    expect(JSON.stringify(runs[0]?.inputSnapshot)).not.toContain('Maria');
  });

  it('faz failover em limite de taxa e registra qual rota respondeu', async () => {
    const deepseek = new FakeVendor(
      'DEEPSEEK',
      () => new VendorError('RATE_LIMIT', 'DEEPSEEK', '429'),
    );
    const openai = new FakeVendor('OPENAI', () => ok('{}'));
    const { gateway, runs } = setup(
      [deepseek, openai],
      [route('DEEPSEEK', 'a'), route('OPENAI', 'b')],
    );
    const result = await gateway.complete(request);
    expect(result.vendor).toBe('OPENAI');
    expect(runs.at(-1)).toMatchObject({ status: 'COMPLETED', attempt: 2 });
  });

  it('nunca envia dado de saúde a fornecedor sem diligência aprovada', async () => {
    const blocked = new FakeVendor('DEEPSEEK', () => ok('{}'), { health: false });
    const approved = new FakeVendor('ANTHROPIC', () => ok('{}'));
    const { gateway } = setup(
      [blocked, approved],
      [route('DEEPSEEK', 'a'), route('ANTHROPIC', 'b')],
    );
    const result = await gateway.complete(request);
    expect(blocked.calls).toHaveLength(0);
    expect(result.vendor).toBe('ANTHROPIC');
  });

  it('pedido com imagem só vai para modelo com visão', async () => {
    const textOnly = new FakeVendor('DEEPSEEK', () => ok('{}'));
    const vision = new FakeVendor('OPENAI', () => ok('{}'));
    const { gateway } = setup(
      [textOnly, vision],
      [route('DEEPSEEK', 'a'), route('OPENAI', 'b', true)],
    );
    await gateway.complete({
      ...request,
      tier: 'VISION',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'O que tem no prato?' },
            { type: 'image', mediaType: 'image/jpeg', base64: 'AAAA' },
          ],
        },
      ],
    });
    expect(textOnly.calls).toHaveLength(0);
    expect(vision.calls).toHaveLength(1);
  });

  it('erro do chamador (4xx) aborta sem failover', async () => {
    const first = new FakeVendor('DEEPSEEK', () => new VendorError('CLIENT', 'DEEPSEEK', '400'));
    const second = new FakeVendor('OPENAI', () => ok('{}'));
    const { gateway, runs } = setup(
      [first, second],
      [route('DEEPSEEK', 'a'), route('OPENAI', 'b')],
    );
    await expect(gateway.complete(request)).rejects.toBeInstanceOf(VendorError);
    expect(second.calls).toHaveLength(0);
    expect(runs.at(-1)).toMatchObject({ status: 'FAILED', errorCode: 'VENDOR_CLIENT' });
  });

  it('erro de rede tem um retry na mesma rota antes do failover', async () => {
    const flaky = new FakeVendor('DEEPSEEK', (call) =>
      call === 1 ? new VendorError('TRANSIENT', 'DEEPSEEK', 'rede') : ok('{}'),
    );
    const { gateway } = setup([flaky], [route('DEEPSEEK', 'a')]);
    const result = await gateway.complete(request);
    expect(result.vendor).toBe('DEEPSEEK');
    expect(flaky.calls).toHaveLength(2);
  });

  it('sem rota elegível, falha com TierUnavailableError e registra a falha', async () => {
    const noKey = new FakeVendor('DEEPSEEK', () => ok('{}'), { key: false });
    const { gateway, runs } = setup([noKey], [route('DEEPSEEK', 'a')]);
    await expect(gateway.complete(request)).rejects.toBeInstanceOf(TierUnavailableError);
    expect(runs.at(-1)).toMatchObject({ status: 'FAILED' });
  });
});

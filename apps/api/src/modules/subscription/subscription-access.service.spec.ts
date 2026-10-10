import { describe, expect, it, vi } from 'vitest';

import { SubscriptionAccessService } from './subscription-access.service';

const USER = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'T'.repeat(43);
const CODE = 'A'.repeat(24);

function make(
  over: {
    subscription?: unknown;
    subscriber?: string | null;
    target?: string | null;
    owner?: string | null;
    used?: number;
  } = {},
) {
  const repo = {
    findByUserId: vi.fn(() => Promise.resolve('subscription' in over ? over.subscription : {})),
    findSubscriberByPhone: vi.fn(() =>
      Promise.resolve('subscriber' in over ? over.subscriber : USER),
    ),
  };
  const subs = {
    createShortCancelLink: vi.fn(() => Promise.resolve('https://movivo.test/cancelar/novo')),
    createShortCheckoutLink: vi.fn(() => Promise.resolve('https://movivo.test/checkout/novo')),
  };
  const accessLinks = {
    ownerOf: vi.fn(() => Promise.resolve('owner' in over ? over.owner : USER)),
  };
  const shortLinks = {
    resolveForRenewal: vi.fn(() =>
      Promise.resolve('target' in over ? over.target : `https://movivo.test/conta/${TOKEN}`),
    ),
  };
  const enqueue = vi.fn(() => Promise.resolve());
  const events = { register: vi.fn(() => vi.fn()) };
  const redis = { incr: vi.fn(() => Promise.resolve(over.used ?? 1)), expire: vi.fn() };
  const keys = { forUser: vi.fn(() => 'k') };
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const service = new SubscriptionAccessService(
    repo as never,
    subs as never,
    accessLinks as never,
    shortLinks as never,
    { enqueue } as never,
    events as never,
    redis as never,
    keys as never,
    logger as never,
  );
  return { service, repo, subs, accessLinks, shortLinks, enqueue, events, redis };
}

const sentTo = (enqueue: ReturnType<typeof make>['enqueue']) =>
  (enqueue.mock.calls as unknown as unknown[][]).map((call) => call[2] as Record<string, unknown>);

describe('SubscriptionAccessService — WhatsApp', () => {
  it('registra o tratamento da mensagem no barramento', () => {
    const { service, events } = make();
    service.onModuleInit();
    expect(events.register).toHaveBeenCalledWith(
      'subscription.inbound.received',
      expect.any(Function),
    );
  });

  it('pedido de cancelamento devolve o link ao próprio titular e consome a mensagem', async () => {
    const { service, enqueue, subs } = make();
    await expect(
      service.handleInbound(USER, 'quero cancelar minha assinatura', 'm1'),
    ).resolves.toBe(true);
    expect(subs.createShortCancelLink).toHaveBeenCalledWith(USER);
    const [job] = sentTo(enqueue);
    expect(job).toMatchObject({ userId: USER, type: 'COACH_MESSAGE' });
    expect(String(job?.text)).toContain('https://movivo.test/cancelar/novo');
    expect(String(job?.text)).not.toMatch(/diagn[óo]stico|tratamento|cura|resultado garantido/i);
  });

  it.each(['TRIALING', 'EXPIRED', 'CANCELED', 'PENDING_PAYMENT'])(
    'quem está %s e pede para assinar recebe o link do checkout',
    async (status) => {
      const { service, enqueue, subs } = make({ subscription: { status } });
      await expect(service.handleInbound(USER, 'quero voltar a assinar', 'm9')).resolves.toBe(true);
      expect(subs.createShortCheckoutLink).toHaveBeenCalledWith(USER);
      expect(subs.createShortCancelLink).not.toHaveBeenCalled();
      expect(String(sentTo(enqueue)[0]?.text)).toContain('https://movivo.test/checkout/novo');
    },
  );

  it.each(['ACTIVE', 'PAUSED'])(
    'quem está %s e fala em renovar segue com a IA (nada é enviado)',
    async (status) => {
      const { service, enqueue } = make({ subscription: { status } });
      await expect(service.handleInbound(USER, 'quero renovar meu plano', 'm10')).resolves.toBe(
        false,
      );
      expect(enqueue).not.toHaveBeenCalled();
    },
  );

  it('cancelar tem precedência sobre assinar na mesma mensagem', async () => {
    const { service, subs } = make({ subscription: { status: 'EXPIRED' } });
    await service.handleInbound(
      USER,
      'quero cancelar a assinatura e assinar de novo depois',
      'm11',
    );
    expect(subs.createShortCancelLink).toHaveBeenCalled();
    expect(subs.createShortCheckoutLink).not.toHaveBeenCalled();
  });

  it('mensagem comum não é consumida e nada é enviado', async () => {
    const { service, enqueue } = make();
    await expect(service.handleInbound(USER, 'como faço o agachamento?', 'm2')).resolves.toBe(
      false,
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('titular sem assinatura não recebe link (a IA responde normalmente)', async () => {
    const { service, enqueue } = make({ subscription: null });
    await expect(service.handleInbound(USER, 'quero cancelar', 'm3')).resolves.toBe(false);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('acima do limite por hora a mensagem é consumida, mas nenhum link novo sai', async () => {
    const { service, enqueue } = make({ used: 6 });
    await expect(service.handleInbound(USER, 'quero cancelar', 'm4')).resolves.toBe(true);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe('SubscriptionAccessService — página pública por telefone', () => {
  it('envia o link ao WhatsApp cadastrado do titular encontrado pelo telefone exato', async () => {
    const { service, repo, enqueue } = make();
    await service.requestPortalLinkByPhone('11987654321');
    expect(repo.findSubscriberByPhone).toHaveBeenCalledWith('+5511987654321');
    expect(sentTo(enqueue)[0]).toMatchObject({ userId: USER });
  });

  it('número sem cliente: não envia nada e não falha (resposta idêntica no controller)', async () => {
    const { service, enqueue } = make({ subscriber: null });
    await expect(service.requestPortalLinkByPhone('11987654321')).resolves.toBeUndefined();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('telefone inválido nem consulta o banco', async () => {
    const { service, repo } = make();
    await service.requestPortalLinkByPhone('123');
    expect(repo.findSubscriberByPhone).not.toHaveBeenCalled();
  });
});

describe('SubscriptionAccessService — link curto vencido', () => {
  it('cancelar vencido → novo link do portal para o dono do link antigo', async () => {
    const { service, accessLinks, subs, enqueue } = make();
    await service.renewFromShortCode(CODE);
    expect(accessLinks.ownerOf).toHaveBeenCalledWith(TOKEN, 'SUBSCRIPTION_PORTAL');
    expect(subs.createShortCancelLink).toHaveBeenCalledWith(USER);
    expect(sentTo(enqueue)[0]).toMatchObject({ userId: USER });
  });

  it('checkout vencido → novo link de checkout', async () => {
    const { service, accessLinks, subs } = make({ target: `https://movivo.test/assinar/${TOKEN}` });
    await service.renewFromShortCode(CODE);
    expect(accessLinks.ownerOf).toHaveBeenCalledWith(TOKEN, 'CHECKOUT');
    expect(subs.createShortCheckoutLink).toHaveBeenCalledWith(USER);
  });

  it.each([
    ['código com formato inválido', { code: 'curto' }],
    ['código desconhecido', { target: null }],
    ['destino que não é um link nosso', { target: 'https://evil.example/x' }],
    ['token revogado ou titular anonimizado', { owner: null }],
  ])('%s → não envia nada', async (_label, over) => {
    const { service, enqueue } = make(over as never);
    await service.renewFromShortCode('code' in over ? (over.code as string) : CODE);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

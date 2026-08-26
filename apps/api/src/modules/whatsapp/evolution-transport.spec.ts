import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EvolutionHttpTransport } from './evolution-transport';
import { PHONE_VERIFICATION_TEMPLATE, phoneVerificationMessage } from './message-templates';

const logger = { info: vi.fn(), warn: vi.fn(), setContext: vi.fn() } as never;

/** Simula `fetchInstances` → `sendPresence` → `sendText`, todas OK, nessa ordem. */
function mockConnectedSendFlow() {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(
      new Response(JSON.stringify([{ name: 'minha-empresa' }]), { status: 200 }),
    )
    .mockResolvedValueOnce(new Response(null, { status: 200 }))
    .mockResolvedValueOnce(new Response(null, { status: 200 }));
}

describe('EvolutionHttpTransport (painel "Sistema → Integração")', () => {
  it('sem credencial: hasCredentials=false', () => {
    const t = new EvolutionHttpTransport('http://localhost:8081', undefined, logger);
    expect(t.hasCredentials()).toBe(false);
  });

  // Achado de QA 2026-08-25: sem este aviso, o app sobe normal, o painel diz "conectado"
  // e o inbound morre em silêncio — só se descobre tentando mandar mensagem de verdade.
  it('com EVOLUTION_API_KEY mas sem EVOLUTION_WEBHOOK_TOKEN: avisa que o inbound não vai funcionar', () => {
    const localLogger = { info: vi.fn(), warn: vi.fn(), setContext: vi.fn() } as never;
    new EvolutionHttpTransport('http://localhost:8081', 'k', localLogger, {
      url: 'http://host.docker.internal:3001/api/v1/webhook/whatsapp/evolution',
      token: undefined,
    });
    expect((localLogger as { warn: ReturnType<typeof vi.fn> }).warn).toHaveBeenCalledWith(
      expect.stringContaining('EVOLUTION_WEBHOOK_TOKEN ausente'),
    );
  });

  it('com EVOLUTION_WEBHOOK_TOKEN configurado: não avisa', () => {
    const localLogger = { info: vi.fn(), warn: vi.fn(), setContext: vi.fn() } as never;
    new EvolutionHttpTransport('http://localhost:8081', 'k', localLogger, {
      url: 'http://host.docker.internal:3001/api/v1/webhook/whatsapp/evolution',
      token: 'a'.repeat(43),
    });
    expect((localLogger as { warn: ReturnType<typeof vi.fn> }).warn).not.toHaveBeenCalledWith(
      expect.stringContaining('EVOLUTION_WEBHOOK_TOKEN ausente'),
    );
  });

  it('sem credencial: createInstance/connectionState lançam erro claro, sem fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const t = new EvolutionHttpTransport('http://localhost:8081', undefined, logger);
    await expect(t.createInstance('minha-empresa')).rejects.toThrow(/EVOLUTION_API_KEY ausente/);
    await expect(t.connectionState('minha-empresa')).rejects.toThrow(/EVOLUTION_API_KEY ausente/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('createInstance: chama POST /instance/create autenticado e devolve o QR code', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ qrcode: { base64: 'data:image/png;base64,abc' } }), {
        status: 201,
      }),
    );
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger);

    const result = await t.createInstance('minha-empresa');

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:8081/instance/create');
    expect((init?.headers as Record<string, string>).apikey).toBe('k');
    expect(JSON.parse(String(init?.body))).toEqual({
      instanceName: 'minha-empresa',
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
    });
    expect(result).toEqual({ status: 'CONNECTING', qrCodeBase64: 'data:image/png;base64,abc' });
    fetchSpy.mockRestore();
  });

  it('createInstance: nome já em uso (403) cai para buscar o QR pendente, não lança (US clicar de novo)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ response: { message: ['This name "x" is already in use.'] } }),
          {
            status: 403,
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ count: 2, base64: 'data:image/png;base64,pendente' }), {
          status: 200,
        }),
      );
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger);

    const result = await t.createInstance('minha-empresa');

    expect(result).toEqual({
      status: 'CONNECTING',
      qrCodeBase64: 'data:image/png;base64,pendente',
    });
    expect(fetchSpy.mock.calls[1]?.[0]).toBe(
      'http://localhost:8081/instance/connect/minha-empresa',
    );
    fetchSpy.mockRestore();
  });

  it('createInstance: outros erros do provedor continuam propagando', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('boom', { status: 500 }));
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger);
    await expect(t.createInstance('minha-empresa')).rejects.toThrow(/500/);
    fetchSpy.mockRestore();
  });

  it('connectionState: mapeia open/connecting/close pro nosso enum', async () => {
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger);
    for (const [raw, expected] of [
      ['open', 'CONNECTED'],
      ['connecting', 'CONNECTING'],
      ['close', 'DISCONNECTED'],
    ] as const) {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response(JSON.stringify({ instance: { state: raw } }), { status: 200 }),
        );
      await expect(t.connectionState('minha-empresa')).resolves.toBe(expected);
      fetchSpy.mockRestore();
    }
  });

  it('currentInstanceName: lê o nome da primeira instância existente', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify([{ name: 'minha-empresa' }]), { status: 200 }),
      );
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger);
    await expect(t.currentInstanceName()).resolves.toBe('minha-empresa');
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('http://localhost:8081/instance/fetchInstances');
    fetchSpy.mockRestore();
  });

  it('currentInstanceName: null quando não há nenhuma instância', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('[]', { status: 200 }));
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger);
    await expect(t.currentInstanceName()).resolves.toBeNull();
    fetchSpy.mockRestore();
  });

  it('erro do provedor lança com detalhe', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('instance not found', { status: 404 }));
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger);
    await expect(t.connectionState('inexistente')).rejects.toThrow(/404/);
    fetchSpy.mockRestore();
  });

  it('fetchQrCode: GET /instance/connect/{name}, lê o base64 direto (corpo achatado)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ count: 1, base64: 'data:image/png;base64,abc' }), {
        status: 200,
      }),
    );
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger);
    await expect(t.fetchQrCode('minha-empresa')).resolves.toBe('data:image/png;base64,abc');
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'http://localhost:8081/instance/connect/minha-empresa',
    );
    fetchSpy.mockRestore();
  });

  it('fetchQrCode: null quando a EvolutionAPI ainda não gerou nenhum QR', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ count: 0 }), { status: 200 }));
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger);
    await expect(t.fetchQrCode('minha-empresa')).resolves.toBeNull();
    fetchSpy.mockRestore();
  });
});

function spyOnRandom() {
  return vi.spyOn(Math, 'random');
}

describe('EvolutionHttpTransport (WhatsappTransport — WHATSAPP_TRANSPORT_PROVIDER=EVOLUTION)', () => {
  let randomSpy: ReturnType<typeof spyOnRandom>;

  beforeEach(() => {
    randomSpy = spyOnRandom();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('send: sem credencial, no-op logado sem fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const t = new EvolutionHttpTransport('http://localhost:8081', undefined, logger);
    await expect(t.send({ to: '+5541999999999', text: 'oi' })).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('send: sem instância conectada, no-op logado sem enviar', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('[]', { status: 200 }));
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger);
    await expect(t.send({ to: '+5541999999999', text: 'oi' })).resolves.toBeUndefined();
    // Só a consulta de instância (fetchInstances) — nenhum envio de fato.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('send: com instância conectada, "digitando" com atraso 15-20s ANTES do texto', async () => {
    randomSpy.mockReturnValue(0); // extremo inferior: delay = 15000
    const fetchSpy = mockConnectedSendFlow();
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger);

    await t.send({ to: '+5541999999999', text: 'oi, tudo bem?' });

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const [presenceUrl, presenceInit] = fetchSpy.mock.calls[1] ?? [];
    expect(presenceUrl).toBe('http://localhost:8081/chat/sendPresence/minha-empresa');
    expect(JSON.parse(String(presenceInit?.body))).toEqual({
      number: '5541999999999',
      presence: 'composing',
      delay: 15_000,
    });
    const [textUrl, textInit] = fetchSpy.mock.calls[2] ?? [];
    expect(textUrl).toBe('http://localhost:8081/message/sendText/minha-empresa');
    expect(JSON.parse(String(textInit?.body))).toEqual({
      number: '5541999999999',
      text: 'oi, tudo bem?',
    });
  });

  it('send: atraso "humano" nunca passa de 20s (extremo superior de Math.random)', async () => {
    randomSpy.mockReturnValue(0.999_999);
    const fetchSpy = mockConnectedSendFlow();
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger);

    await t.send({ to: '+5541999999999', text: 'oi' });

    const [, presenceInit] = fetchSpy.mock.calls[1] ?? [];
    const body = JSON.parse(String(presenceInit?.body)) as { delay: number };
    expect(body.delay).toBeGreaterThanOrEqual(15_000);
    expect(body.delay).toBeLessThanOrEqual(20_000);
  });

  it('sendTemplate: PHONE_VERIFICATION_TEMPLATE renderiza o texto real e envia (com humanização)', async () => {
    randomSpy.mockReturnValue(0);
    const fetchSpy = mockConnectedSendFlow();
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger);

    await t.sendTemplate('+5541999999999', PHONE_VERIFICATION_TEMPLATE, ['123456']);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const [, textInit] = fetchSpy.mock.calls[2] ?? [];
    expect(JSON.parse(String(textInit?.body))).toEqual({
      number: '5541999999999',
      text: phoneVerificationMessage('123456'),
    });
  });

  it('sendTemplate: template desconhecido é descartado, sem fetch algum', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger);
    await expect(
      t.sendTemplate('+5541999999999', 'outro_template', ['x']),
    ).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sendTyping: ping curto de "composing", não é o atraso anti-ban', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ name: 'minha-empresa' }]), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger);

    await t.sendTyping('+5541999999999');

    const [, presenceInit] = fetchSpy.mock.calls[1] ?? [];
    expect(JSON.parse(String(presenceInit?.body))).toEqual({
      number: '5541999999999',
      presence: 'composing',
      delay: 3_000,
    });
  });

  it('sendTyping: best-effort — erro do provedor é engolido, nunca lança', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ name: 'minha-empresa' }]), { status: 200 }),
      )
      .mockRejectedValueOnce(new Error('rede caiu'));
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger);
    await expect(t.sendTyping('+5541999999999')).resolves.toBeUndefined();
  });

  it('sendTyping: sem instância conectada, no-op silencioso', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('[]', { status: 200 }));
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger);
    await expect(t.sendTyping('+5541999999999')).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // Achado 2026-08-22 (US-2.6-PDF): documento do protocolo também sai pela EvolutionAPI,
  // não só pelo BSP oficial — contrato confirmado em `dist/validate/message.schema.js`
  // (`mediaMessageSchema`) do container real, não a doc prosa.
  it('sendDocument: POST /message/sendMedia com mediatype document e fileName (com humanização)', async () => {
    randomSpy.mockReturnValue(0);
    const fetchSpy = mockConnectedSendFlow();
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger);

    await t.sendDocument(
      '+5541999999999',
      'https://movivo.test/protocolo/abc/pdf',
      'Seu protocolo chegou!',
    );

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    const [presenceUrl] = fetchSpy.mock.calls[1] ?? [];
    expect(presenceUrl).toBe('http://localhost:8081/chat/sendPresence/minha-empresa');
    const [mediaUrl, mediaInit] = fetchSpy.mock.calls[2] ?? [];
    expect(mediaUrl).toBe('http://localhost:8081/message/sendMedia/minha-empresa');
    expect(JSON.parse(String(mediaInit?.body))).toEqual({
      number: '5541999999999',
      mediatype: 'document',
      mimetype: 'application/pdf',
      media: 'https://movivo.test/protocolo/abc/pdf',
      fileName: 'protocolo-movivo.pdf',
      caption: 'Seu protocolo chegou!',
    });
  });

  // Achado 2026-08-25: `media` com `localhost`/`127.0.0.1` é inalcançável para a
  // EvolutionAPI (roda no container Docker, não no host) — falhava com "Owned media
  // must be a url or base64" ao tentar buscar o PDF sozinha. `PUBLIC_SITE_URL` local
  // aponta pro `apps/web` no host (`http://localhost:3000`), correto para o link de
  // texto do titular, mas precisa virar `host.docker.internal` só para este transporte.
  it('sendDocument: reescreve localhost/127.0.0.1 para host.docker.internal (container Docker)', async () => {
    randomSpy.mockReturnValue(0);
    const fetchSpy = mockConnectedSendFlow();
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger);

    await t.sendDocument(
      '+5541999999999',
      'http://localhost:3000/protocolo/abc/pdf',
      'Seu protocolo chegou!',
    );

    const [, mediaInit] = fetchSpy.mock.calls[2] ?? [];
    expect(JSON.parse(String(mediaInit?.body))).toMatchObject({
      media: 'http://host.docker.internal:3000/protocolo/abc/pdf',
    });
  });

  it('sendDocument: URL pública (produção/staging) não é reescrita', async () => {
    randomSpy.mockReturnValue(0);
    const fetchSpy = mockConnectedSendFlow();
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger);

    await t.sendDocument(
      '+5541999999999',
      'https://movivo.app/protocolo/abc/pdf',
      'Seu protocolo chegou!',
    );

    const [, mediaInit] = fetchSpy.mock.calls[2] ?? [];
    expect(JSON.parse(String(mediaInit?.body))).toMatchObject({
      media: 'https://movivo.app/protocolo/abc/pdf',
    });
  });

  it('sendDocument: sem instância conectada, no-op logado sem enviar', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('[]', { status: 200 }));
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger);
    await expect(
      t.sendDocument('+5541999999999', 'https://movivo.test/protocolo/abc/pdf', 'legenda'),
    ).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('sendDocument: sem credencial, no-op logado sem fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const t = new EvolutionHttpTransport('http://localhost:8081', undefined, logger);
    await expect(
      t.sendDocument('+5541999999999', 'https://movivo.test/protocolo/abc/pdf', 'legenda'),
    ).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('EvolutionHttpTransport — webhook de ENTRADA (US-3.1-EVO)', () => {
  const webhook = { url: 'http://localhost:3001/api/v1/webhook/whatsapp/evolution', token: 'tok' };

  it('configureWebhook: registra com menor privilégio e reescreve localhost para o container', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger, webhook);

    await t.configureWebhook('minha-empresa', webhook.url, webhook.token);

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:8081/webhook/set/minha-empresa');
    expect((init?.headers as Record<string, string>).apikey).toBe('k');
    expect(JSON.parse(String(init?.body))).toEqual({
      webhook: {
        enabled: true,
        // localhost do host não é alcançável de dentro do container.
        url: 'http://host.docker.internal:3001/api/v1/webhook/whatsapp/evolution',
        headers: { 'x-movivo-webhook-token': 'tok', 'content-type': 'application/json' },
        byEvents: false,
        base64: false,
        events: ['MESSAGES_UPSERT'],
      },
    });
    fetchSpy.mockRestore();
  });

  it('ensureWebhookConfigured: idempotente — só um POST por instância, mesmo com o polling de 3s', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }));
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger, webhook);

    await t.ensureWebhookConfigured('minha-empresa');
    await t.ensureWebhookConfigured('minha-empresa');
    await t.ensureWebhookConfigured('minha-empresa');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockRestore();
  });

  it('ensureWebhookConfigured: sem token configurado, no-op (a borda descartaria tudo mesmo)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger, {
      url: webhook.url,
      token: undefined,
    });
    await expect(t.ensureWebhookConfigured('minha-empresa')).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('ensureWebhookConfigured: falha da EvolutionAPI nunca propaga (e permite nova tentativa)', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger, webhook);

    await expect(t.ensureWebhookConfigured('minha-empresa')).resolves.toBeUndefined();
    await t.ensureWebhookConfigured('minha-empresa');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    fetchSpy.mockRestore();
  });

  it('lastKnownInstanceName: null até descobrir, depois alimenta a borda de entrada', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify([{ name: 'minha-empresa' }]), { status: 200 }),
      );
    const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger);

    expect(t.lastKnownInstanceName()).toBeNull();
    await t.currentInstanceName();
    expect(t.lastKnownInstanceName()).toBe('minha-empresa');
    fetchSpy.mockRestore();
  });

  describe('onModuleInit (aquecimento do boot)', () => {
    it('sem EVOLUTION_API_KEY: não consulta nem reafirma nada', async () => {
      const t = new EvolutionHttpTransport('http://localhost:8081', undefined, logger);
      const current = vi.spyOn(t, 'currentInstanceName');
      const ensure = vi.spyOn(t, 'ensureWebhookConfigured');

      await t.onModuleInit();

      expect(current).not.toHaveBeenCalled();
      expect(ensure).not.toHaveBeenCalled();
    });

    it('instância já conhecida: não consulta de novo', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response(JSON.stringify([{ name: 'minha-empresa' }]), { status: 200 }),
        );
      const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger);
      await t.currentInstanceName();
      fetchSpy.mockRestore();
      const current = vi.spyOn(t, 'currentInstanceName');

      await t.onModuleInit();

      expect(current).not.toHaveBeenCalled();
    });

    it('instância desconhecida sem nenhuma criada ainda: não reafirma webhook', async () => {
      const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger);
      vi.spyOn(t, 'currentInstanceName').mockResolvedValue(null);
      const ensure = vi.spyOn(t, 'ensureWebhookConfigured').mockResolvedValue(undefined);

      await t.onModuleInit();

      expect(ensure).not.toHaveBeenCalled();
    });

    it('instância desconhecida mas existente: reafirma o webhook nela', async () => {
      const t = new EvolutionHttpTransport('http://localhost:8081', 'k', logger);
      vi.spyOn(t, 'currentInstanceName').mockResolvedValue('minha-empresa');
      const ensure = vi.spyOn(t, 'ensureWebhookConfigured').mockResolvedValue(undefined);

      await t.onModuleInit();

      expect(ensure).toHaveBeenCalledWith('minha-empresa');
    });
  });
});

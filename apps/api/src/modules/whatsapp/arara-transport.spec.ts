import { describe, expect, it, vi } from 'vitest';

import { AraraHttpTransport } from './arara-transport';

const logger = { info: vi.fn(), warn: vi.fn(), setContext: vi.fn() } as never;

describe('AraraHttpTransport (US-2.5)', () => {
  it('sem credencial: hasCredentials=false e send é no-op logado (não lança, não faz fetch)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const t = new AraraHttpTransport('https://api.ararahq.com', undefined, logger);
    expect(t.hasCredentials()).toBe(false);
    await expect(t.send({ to: '+5541999999999', text: 'oi' })).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('com credencial: hasCredentials=true', () => {
    expect(new AraraHttpTransport('https://api.ararahq.com', 'k', logger).hasCredentials()).toBe(
      true,
    );
  });

  it('com credencial: envia o texto no endpoint de mensagens, autenticado', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    const t = new AraraHttpTransport('https://api.ararahq.com', 'k', logger);

    await t.send({ to: '+5541999999999', text: 'oi' });

    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('https://api.ararahq.com/v1/messages');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer k');
    expect(JSON.parse(String(init?.body))).toEqual({
      to: '+5541999999999',
      type: 'text',
      text: { body: 'oi' },
    });
    fetchSpy.mockRestore();
  });

  it('anexa os quick replies só quando existem', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    const t = new AraraHttpTransport('https://api.ararahq.com', 'k', logger);
    const buttons = [{ id: 'workout:DONE:2026-08-10:A', title: 'Treinei' }];

    await t.send({ to: '+5541999999999', text: 'oi', buttons });
    await t.send({ to: '+5541999999999', text: 'oi', buttons: [] });

    const bodies = fetchSpy.mock.calls.map((call) => JSON.parse(String(call[1]?.body)));
    expect(bodies[0]).toMatchObject({ buttons });
    expect(bodies[1]).not.toHaveProperty('buttons');
    fetchSpy.mockRestore();
  });

  it('erro do provedor lança — o BullMQ é quem decide retentar', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('boom', { status: 503 }));
    const t = new AraraHttpTransport('https://api.ararahq.com', 'k', logger);

    await expect(t.send({ to: '+5541999999999', text: 'oi' })).rejects.toThrow(/503/);
    fetchSpy.mockRestore();
  });

  it('typing é best-effort: no-op sem credencial e engole falha de rede com credencial', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('rede caiu'));

    await expect(
      new AraraHttpTransport('https://api.ararahq.com', undefined, logger).sendTyping('+55419'),
    ).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();

    await expect(
      new AraraHttpTransport('https://api.ararahq.com', 'k', logger).sendTyping('+55419'),
    ).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledOnce();
    fetchSpy.mockRestore();
  });

  it('typing nunca loga o telefone do destinatário quando falha', async () => {
    const info = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('rede caiu'));
    const scoped = { info, warn: vi.fn(), setContext: vi.fn() } as never;

    await new AraraHttpTransport('https://api.ararahq.com', 'k', scoped).sendTyping(
      '+5541999999999',
    );

    expect(info).toHaveBeenCalledWith({ to: '[redacted]' }, expect.any(String));
    fetchSpy.mockRestore();
  });
});

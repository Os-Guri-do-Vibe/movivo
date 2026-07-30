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
});

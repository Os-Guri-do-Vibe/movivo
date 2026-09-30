/** Sitemap: só a home enquanto os textos legais estão bloqueados; nunca rota privada. */
import { describe, expect, it } from 'vitest';

import sitemap from './sitemap';

describe('sitemap', () => {
  it('lista apenas URLs públicas absolutas do domínio do site', () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toMatch(/^https?:\/\//);
      expect(url).not.toMatch(
        /\/(api|dashboard|entrar|anamnese|treino|protocolo|assinar|conta)(\/|$)/,
      );
    }
    expect(urls[0]).toMatch(/\/$/);
  });
});

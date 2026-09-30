import type { MetadataRoute } from 'next';

import { publicEnv } from '@/lib/env';
import { LEGAL_LINKS } from '@/lib/landing/site';

/**
 * Sitemap só com páginas públicas e indexáveis. Áreas por token, anamnese, treino e API
 * ficam de fora (já são `noindex`/bloqueadas em `robots.txt`). Termos e Privacidade
 * entram sozinhos quando a liberação jurídica deixar as rotas no ar — hoje respondem 404.
 *
 * Sem `lastModified`: o buscador ignora data que não reflete mudança real de conteúdo.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const origin = new URL(publicEnv.siteUrl).origin;
  const legalPaths = [LEGAL_LINKS.terms, LEGAL_LINKS.privacy].filter(
    (path): path is string => path !== null,
  );

  return [
    { url: `${origin}/`, changeFrequency: 'weekly', priority: 1 },
    ...legalPaths.map((path) => ({
      url: `${origin}${path}`,
      changeFrequency: 'yearly' as const,
      priority: 0.3,
    })),
  ];
}

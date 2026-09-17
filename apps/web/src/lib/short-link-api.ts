/**
 * Cliente do endpoint interno de resolução do link curto (`ShortLinkController`, API).
 * Chamado só a partir de `route.ts` (`/check-in/[code]`, `/renovacao/[code]`) — a API não
 * é publicamente roteável (mesmo motivo de `app/protocolo/[token]/pdf/route.ts`), nunca é
 * o browser que chega direto aqui. Sem `import 'server-only'` de propósito: o pacote não
 * resolve fora do bundler do Next (quebra o Vitest — nenhum outro `_lib/bff.ts` que o usa
 * tem teste unitário hoje por causa disso), e este módulo não é importado por nenhum
 * Client Component de qualquer forma.
 */
import { publicEnv } from './env';

const API_BASE = (process.env.MOVIVO_API_URL?.trim() || publicEnv.apiUrl).replace(/\/$/, '');

/** `null` = código inexistente ou expirado — quem chama decide a resposta (410, etc). */
export async function resolveShortLink(code: string): Promise<string | null> {
  const res = await fetch(`${API_BASE}/short-links/${encodeURIComponent(code)}`, {
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as { url?: unknown } | null;
  return typeof body?.url === 'string' ? body.url : null;
}

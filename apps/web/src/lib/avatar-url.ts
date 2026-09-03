const AVATAR_FILENAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

/**
 * Reescreve a URL absoluta que a API devolve (`http://<api-host>/api/v1/account/avatar/<file>`)
 * para a rota same-origin deste app (`/api/dashboard/account/avatar/<file>`).
 *
 * Obrigatório antes de usar em `<img src>`: a CSP restringe `img-src` a `'self'` (ver
 * `src/proxy.ts`), então a URL absoluta da API é bloqueada silenciosamente pelo
 * navegador — a foto "some" depois do upload. `null`/formato inesperado vira `null`
 * (cai no fallback de iniciais em vez de tentar carregar algo quebrado).
 */
export function toDashboardAvatarUrl(avatarUrl: string | null): string | null {
  if (!avatarUrl) return null;
  const filename = avatarUrl.slice(avatarUrl.lastIndexOf('/') + 1);
  return AVATAR_FILENAME_RE.test(filename) ? `/api/dashboard/account/avatar/${filename}` : null;
}

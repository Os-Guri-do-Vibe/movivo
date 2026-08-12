const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const TOKEN_ROUTE = new Set(['anamnese', 'protocolo', 'conta', 'assinar']);

function sanitizeAnalyticsPath(pathname: string): string {
  const parts = pathname.split('/').map((part, index, all) => {
    if (UUID_SEGMENT.test(part)) return ':id';
    if (all[index - 1] === 'alunos' && part) return ':id';
    if (index === 2 && TOKEN_ROUTE.has(all[1] ?? '') && part) return ':token';
    return part;
  });
  return parts.join('/');
}

export function sanitizeAnalyticsUrl(value: string): string {
  try {
    const url = new URL(value, 'https://movivo.invalid');
    const safePath = sanitizeAnalyticsPath(url.pathname);
    if (url.pathname.startsWith('/dashboard') || safePath !== url.pathname) {
      return url.origin === 'https://movivo.invalid' ? safePath : `${url.origin}${safePath}`;
    }
    return value;
  } catch {
    const pathname = value.split(/[?#]/, 1)[0] ?? value;
    const safePath = sanitizeAnalyticsPath(pathname);
    return value.startsWith('/dashboard') || safePath !== pathname ? safePath : value;
  }
}

export function sanitizeAnalyticsProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const safe = { ...properties };
  for (const key of ['$current_url', '$referrer', '$pathname', '$prev_pageview_pathname']) {
    if (typeof safe[key] === 'string') safe[key] = sanitizeAnalyticsUrl(safe[key]);
  }
  return safe;
}

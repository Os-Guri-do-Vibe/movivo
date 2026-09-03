import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { BFF_ACCESS_COOKIE, BFF_REFRESH_COOKIE } from '@/app/api/dashboard/_lib/bff';
import {
  defaultCapabilitiesForRole,
  hasAllCapabilities,
  isDashboardCapability,
  isDashboardRole,
  type DashboardCapability,
  type DashboardRole,
} from '@/lib/control-center-access';
import { toDashboardAvatarUrl } from '@/lib/avatar-url';
import { publicEnv } from '@/lib/env';

const API_BASE = (process.env.MOVIVO_API_URL?.trim() || publicEnv.apiUrl).replace(/\/$/, '');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checagem segura próxima da página, além do RBAC do BFF/backend.
 *
 * Server Components não podem rotacionar cookies. Quando o access de 15 minutos
 * expira, redirecionamos ao Route Handler de sessão, que faz a rotação e volta ao
 * dashboard. O identificador retornado por `/auth/me` não é serializado ao cliente.
 */
export interface ServerDashboardSession {
  role: DashboardRole;
  capabilities: DashboardCapability[];
  name: string | null;
  avatarUrl: string | null;
}

export async function requireDashboardRole(
  nextPath = '/dashboard',
): Promise<ServerDashboardSession> {
  const store = await cookies();
  const access = store.get(BFF_ACCESS_COOKIE)?.value;
  const refresh = store.get(BFF_REFRESH_COOKIE)?.value;

  if (!access) {
    if (refresh) redirect(`/api/dashboard/session?next=${encodeURIComponent(nextPath)}`);
    redirect('/entrar');
  }

  const response = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${access}` },
    cache: 'no-store',
  });
  if (response.status === 401 && refresh) {
    redirect(`/api/dashboard/session?next=${encodeURIComponent(nextPath)}`);
  }
  if (!response.ok) redirect('/entrar');

  const value = (await response.json().catch(() => null)) as unknown;
  if (!isRecord(value) || !isDashboardRole(value.role)) {
    redirect('/entrar?erro=sem-permissao');
  }
  const capabilities = Array.isArray(value.capabilities)
    ? value.capabilities.filter(isDashboardCapability)
    : [];
  return {
    role: value.role,
    capabilities: [
      ...(capabilities.length ? capabilities : defaultCapabilitiesForRole(value.role)),
    ],
    name: typeof value.name === 'string' ? value.name : null,
    avatarUrl: toDashboardAvatarUrl(typeof value.avatarUrl === 'string' ? value.avatarUrl : null),
  };
}

export async function requireDashboardCapability(
  required: DashboardCapability | readonly DashboardCapability[],
  nextPath: string,
): Promise<ServerDashboardSession> {
  const session = await requireDashboardRole(nextPath);
  // AND: mesma semântica de `roleHasCapabilities` no backend — todas as capacidades
  // declaradas pela rota são exigidas. Um OR aqui renderizaria páginas que o backend
  // responderia com 403.
  const expected = Array.isArray(required) ? required : [required];
  if (!hasAllCapabilities(session.capabilities, ...expected)) {
    redirect('/dashboard?erro=sem-permissao');
  }
  return session;
}

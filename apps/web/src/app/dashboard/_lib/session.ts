import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { BFF_ACCESS_COOKIE, BFF_REFRESH_COOKIE } from '@/app/api/dashboard/_lib/bff';
import { publicEnv } from '@/lib/env';
import type { DashboardRole } from '@/lib/dashboard-types';

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
export async function requireDashboardRole(nextPath = '/dashboard'): Promise<DashboardRole> {
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
  if (!isRecord(value) || value.role !== 'PROFESSIONAL') {
    redirect('/entrar?erro=sem-permissao');
  }
  return 'PROFESSIONAL';
}

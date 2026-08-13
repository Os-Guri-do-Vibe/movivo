import { redirect } from 'next/navigation';

import { SummaryDashboard } from '@/components/dashboard/summary-dashboard';
import { landingPathForRole } from '@/lib/control-center-access';

import { requireDashboardRole } from './_lib/session';

export default async function DashboardPage() {
  const session = await requireDashboardRole('/dashboard');
  // Rota padrão por papel (US-7.1): a raiz do dashboard é a porta de entrada do login,
  // e cada papel é encaminhado ao seu pilar. Só o `ADMIN` (e quem mais tiver
  // `overview.read`) permanece aqui.
  if (!session.capabilities.includes('control_center.overview.read')) {
    const target = landingPathForRole(session.role, session.capabilities);
    redirect(target === '/dashboard' ? '/entrar?erro=sem-permissao' : target);
  }
  return <SummaryDashboard resource="overview" />;
}

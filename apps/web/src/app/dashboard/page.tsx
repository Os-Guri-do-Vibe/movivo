import { redirect } from 'next/navigation';

import { SummaryDashboard } from '@/components/dashboard/summary-dashboard';
import { defaultDashboardPath } from '@/lib/control-center-access';

import { requireDashboardRole } from './_lib/session';

export default async function DashboardPage() {
  const session = await requireDashboardRole('/dashboard');
  if (!session.capabilities.includes('control_center.overview.read')) {
    redirect(defaultDashboardPath(session.capabilities) ?? '/entrar?erro=sem-permissao');
  }
  return <SummaryDashboard resource="overview" />;
}

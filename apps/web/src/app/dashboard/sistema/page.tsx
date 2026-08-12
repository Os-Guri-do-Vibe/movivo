import { SummaryDashboard } from '@/components/dashboard/summary-dashboard';

import { requireDashboardCapability } from '../_lib/session';

export default async function SystemPage() {
  await requireDashboardCapability('control_center.system.read', '/dashboard/sistema');
  return <SummaryDashboard resource="system" />;
}

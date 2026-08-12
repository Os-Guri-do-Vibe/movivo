import { SummaryDashboard } from '@/components/dashboard/summary-dashboard';

import { requireDashboardCapability } from '../_lib/session';

export default async function FinancePage() {
  await requireDashboardCapability('control_center.finance.read', '/dashboard/financeiro');
  return <SummaryDashboard resource="finance" />;
}

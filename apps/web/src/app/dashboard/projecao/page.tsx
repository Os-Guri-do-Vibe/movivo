import { FinancialProjectionDashboard } from '@/components/dashboard/financial-projection-dashboard';

import { requireDashboardCapability } from '../_lib/session';

export default async function ProjectionPage() {
  await requireDashboardCapability('control_center.finance.read', '/dashboard/projecao');
  return <FinancialProjectionDashboard />;
}

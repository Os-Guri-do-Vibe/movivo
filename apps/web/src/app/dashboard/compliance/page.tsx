import { ComplianceDashboard } from '@/components/dashboard/compliance-dashboard';

import { requireDashboardCapability } from '../_lib/session';

export default async function CompliancePage() {
  await requireDashboardCapability(
    ['control_center.compliance.read', 'control_center.audit.read'],
    '/dashboard/compliance',
  );
  return <ComplianceDashboard />;
}

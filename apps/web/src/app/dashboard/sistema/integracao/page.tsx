import { IntegrationDashboard } from '@/components/dashboard/integration-dashboard';

import { requireDashboardCapability } from '../../_lib/session';

export default async function IntegrationPage() {
  await requireDashboardCapability('control_center.system.read', '/dashboard/sistema/integracao');
  return <IntegrationDashboard />;
}

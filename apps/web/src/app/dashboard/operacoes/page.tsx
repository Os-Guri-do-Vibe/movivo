import { OperationsDashboard } from '@/components/dashboard/operations-dashboard';

import { requireDashboardCapability } from '../_lib/session';

export default async function OperationsPage() {
  await requireDashboardCapability('control_center.students.read', '/dashboard/operacoes');
  return <OperationsDashboard />;
}

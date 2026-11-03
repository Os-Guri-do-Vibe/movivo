import { ExceptionsQueue } from '@/components/dashboard/exceptions-queue';

import { requireDashboardCapability } from '../_lib/session';

export default async function AlertsPage() {
  await requireDashboardCapability('control_center.exceptions.read', '/dashboard/alertas');
  return <ExceptionsQueue scope="ALERTS" />;
}

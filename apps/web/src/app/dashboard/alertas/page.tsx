import { AlertsBoard } from '@/components/dashboard/alerts-board';

import { requireDashboardCapability } from '../_lib/session';

export default async function AlertsPage() {
  await requireDashboardCapability(
    ['control_center.students.read', 'control_center.students.health.read'],
    '/dashboard/alertas',
  );
  return <AlertsBoard />;
}

import { ExceptionsQueue } from '@/components/dashboard/exceptions-queue';

import { requireDashboardCapability } from '../_lib/session';

export default async function ExceptionsPage() {
  await requireDashboardCapability('control_center.exceptions.read', '/dashboard/fila');
  return <ExceptionsQueue />;
}

import { ExceptionsQueue } from '@/components/dashboard/exceptions-queue';

import { requireDashboardCapability } from '../_lib/session';

export default async function ProfessionalQueuePage() {
  await requireDashboardCapability('control_center.exceptions.read', '/dashboard/fila');
  return <ExceptionsQueue scope="QUEUE" />;
}

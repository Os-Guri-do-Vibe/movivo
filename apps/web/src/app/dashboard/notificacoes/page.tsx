import { Suspense } from 'react';

import { NotificationsBoard } from '@/components/dashboard/notifications-board';

import { requireDashboardCapability } from '../_lib/session';

export default async function NotificationsPage() {
  await requireDashboardCapability(
    ['control_center.students.read', 'control_center.students.health.read'],
    '/dashboard/notificacoes',
  );
  // `useSearchParams` (filtros na URL) exige fronteira de Suspense.
  return (
    <Suspense fallback={null}>
      <NotificationsBoard />
    </Suspense>
  );
}

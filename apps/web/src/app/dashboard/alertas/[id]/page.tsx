import { notFound } from 'next/navigation';

import { AlertDetail } from '@/components/dashboard/alert-detail';

import { requireDashboardCapability } from '../../_lib/session';

export default async function AlertDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireDashboardCapability(
    ['control_center.students.read', 'control_center.students.health.read'],
    '/dashboard/alertas',
  );
  const { id } = await params;
  if (!id) notFound();
  return <AlertDetail id={id} />;
}

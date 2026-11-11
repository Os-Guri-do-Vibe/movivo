import { notFound } from 'next/navigation';
import { uuidSchema } from '@movivo/shared';

import { ExceptionDetail } from '@/components/dashboard/exception-detail';

import { requireDashboardCapability } from '../../_lib/session';

export default async function ExceptionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  await requireDashboardCapability(
    ['control_center.exceptions.read', 'control_center.students.read'],
    `/dashboard/fila/${id}`,
  );
  return <ExceptionDetail id={id} />;
}

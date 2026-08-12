import { StudentDetail } from '@/components/dashboard/student-detail';

import { requireDashboardCapability } from '../../_lib/session';

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireDashboardCapability('control_center.students.read', '/dashboard/alunos');
  const { id } = await params;
  return <StudentDetail id={id} />;
}

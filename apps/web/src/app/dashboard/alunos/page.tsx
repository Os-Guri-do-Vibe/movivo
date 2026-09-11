import { StudentsDashboard } from '@/components/dashboard/students-dashboard';

import { requireDashboardCapability } from '../_lib/session';

export default async function StudentsPage() {
  await requireDashboardCapability('control_center.students.read', '/dashboard/alunos');
  return <StudentsDashboard />;
}

import { StudentsDashboard } from '@/components/dashboard/students-dashboard';
import { hasAllCapabilities } from '@/lib/control-center-access';

import { requireDashboardCapability } from '../_lib/session';

export default async function StudentsPage() {
  const session = await requireDashboardCapability(
    'control_center.students.read',
    '/dashboard/alunos',
  );
  return (
    <StudentsDashboard
      canReadHealth={hasAllCapabilities(
        session.capabilities,
        'control_center.students.health.read',
      )}
    />
  );
}

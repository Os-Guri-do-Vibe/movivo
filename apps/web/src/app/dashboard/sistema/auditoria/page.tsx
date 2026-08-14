import { AuditDashboard } from '@/components/dashboard/audit-dashboard';

import { requireDashboardCapability } from '../../_lib/session';

export default async function AuditPage() {
  await requireDashboardCapability('control_center.audit.read', '/dashboard/sistema/auditoria');
  return <AuditDashboard />;
}

import { ScriptsDashboard } from '@/components/dashboard/scripts-dashboard';

import { requireDashboardCapability } from '../../_lib/session';

export default async function ScriptsPage() {
  await requireDashboardCapability('control_center.system.operate', '/dashboard/sistema/scripts');
  return <ScriptsDashboard />;
}

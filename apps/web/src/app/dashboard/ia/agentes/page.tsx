import { AgentsPanel } from '@/components/dashboard/agents-panel';
import { hasAllCapabilities } from '@/lib/control-center-access';

import { requireDashboardCapability } from '../../_lib/session';

export default async function AgentsPage() {
  const session = await requireDashboardCapability(
    'control_center.agents.read',
    '/dashboard/ia/agentes',
  );
  return (
    <AgentsPanel
      canWriteTiers={hasAllCapabilities(session.capabilities, 'control_center.agents.tiers.write')}
    />
  );
}

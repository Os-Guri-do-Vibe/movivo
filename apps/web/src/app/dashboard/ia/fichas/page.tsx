import { AgentProfiles } from '@/components/dashboard/agent-profiles';
import { hasAllCapabilities } from '@/lib/control-center-access';

import { requireDashboardCapability } from '../../_lib/session';

export default async function AgentProfilesPage() {
  const session = await requireDashboardCapability(
    'control_center.agents.read',
    '/dashboard/ia/fichas',
  );
  return (
    <AgentProfiles
      canWrite={hasAllCapabilities(session.capabilities, 'control_center.agents.profiles.write')}
    />
  );
}

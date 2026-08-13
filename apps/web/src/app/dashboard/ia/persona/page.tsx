import { AiPersonaDashboard } from '@/components/dashboard/ai-persona';
import { hasAllCapabilities } from '@/lib/control-center-access';

import { requireDashboardCapability } from '../../_lib/session';

export default async function AiPersonaPage() {
  const session = await requireDashboardCapability(
    'control_center.ai.config.read',
    '/dashboard/ia/persona',
  );
  // A UI só decide o que exibir; publicar e reverter exigem a capability no endpoint.
  return (
    <AiPersonaDashboard
      canWrite={hasAllCapabilities(session.capabilities, 'control_center.ai.config.write')}
    />
  );
}

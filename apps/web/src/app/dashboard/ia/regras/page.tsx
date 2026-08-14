import { AiRulesDashboard } from '@/components/dashboard/ai-rules';
import { hasAllCapabilities } from '@/lib/control-center-access';

import { requireDashboardCapability } from '../../_lib/session';

export default async function AiRulesPage() {
  const session = await requireDashboardCapability(
    'control_center.ai.config.read',
    '/dashboard/ia/regras',
  );
  return (
    <AiRulesDashboard
      canWrite={hasAllCapabilities(session.capabilities, 'control_center.ai.config.write')}
    />
  );
}

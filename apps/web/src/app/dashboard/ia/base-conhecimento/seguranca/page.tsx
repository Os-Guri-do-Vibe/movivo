import { AiRulesDashboard } from '@/components/dashboard/ai-rules';
import { hasAllCapabilities } from '@/lib/control-center-access';

import { requireDashboardCapability } from '../../../_lib/session';

export default async function KnowledgeSecurityPage() {
  const session = await requireDashboardCapability(
    'control_center.ai.config.read',
    '/dashboard/ia/base-conhecimento/seguranca',
  );
  return (
    <AiRulesDashboard
      showHeader={false}
      canWrite={hasAllCapabilities(session.capabilities, 'control_center.ai.config.write')}
    />
  );
}

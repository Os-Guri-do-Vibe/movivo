import { AiRulesDashboard } from '@/components/dashboard/ai-rules';

import { requireDashboardCapability } from '../../_lib/session';

export default async function AiRulesPage() {
  await requireDashboardCapability('control_center.ai.config.read', '/dashboard/ia/regras');
  return <AiRulesDashboard />;
}

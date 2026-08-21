import { AiAgentDashboard } from '@/components/dashboard/ai-agent-dashboard';
import { hasAllCapabilities } from '@/lib/control-center-access';

import { requireDashboardCapability } from '../../_lib/session';

export default async function AiAgentPage() {
  const session = await requireDashboardCapability(
    'control_center.ai.config.read',
    '/dashboard/ia/agente',
  );
  // A UI só decide o que exibir; publicar, aprovar e reverter exigem a capability no endpoint.
  return (
    <AiAgentDashboard
      canWriteConfig={hasAllCapabilities(session.capabilities, 'control_center.ai.config.write')}
      canApproveGuardrails={hasAllCapabilities(
        session.capabilities,
        'control_center.ai.guardrail.approve',
      )}
    />
  );
}

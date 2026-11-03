import { AiGuardrailsPanel } from '@/components/dashboard/ai-guardrails';
import { PanelHeader } from '@/components/dashboard/knowledge-ui';
import { hasAllCapabilities } from '@/lib/control-center-access';

import { requireDashboardCapability } from '../../../_lib/session';

export default async function KnowledgeSecurityPage() {
  const session = await requireDashboardCapability(
    'control_center.ai.config.read',
    '/dashboard/ia/base-conhecimento/seguranca',
  );
  return (
    <div className="space-y-5">
      <PanelHeader
        id="security-title"
        title="Regras de segurança"
        description="A sentinela de segurança é fixa em código e sempre vence. Os guardrails abaixo apenas sinalizam conversas para revisão humana e nunca reduzem a proteção superior."
      />
      <AiGuardrailsPanel
        canWrite={hasAllCapabilities(session.capabilities, 'control_center.ai.config.write')}
      />
    </div>
  );
}

import { AiGuardrailsPanel } from '@/components/dashboard/ai-guardrails';
import { hasAllCapabilities } from '@/lib/control-center-access';

import { requireDashboardCapability } from '../../../_lib/session';

export default async function KnowledgeSecurityPage() {
  const session = await requireDashboardCapability(
    'control_center.ai.config.read',
    '/dashboard/ia/base-conhecimento/seguranca',
  );
  return (
    <div>
      <h2 className="text-h2 font-bold">Regras de segurança</h2>
      <p className="mt-2 max-w-3xl text-label text-muted-foreground">
        A sentinela de segurança é fixa em código e sempre vence. Os guardrails abaixo apenas
        sinalizam conversas para revisão humana e nunca reduzem a proteção superior.
      </p>
      <AiGuardrailsPanel
        canWrite={hasAllCapabilities(session.capabilities, 'control_center.ai.config.write')}
      />
    </div>
  );
}

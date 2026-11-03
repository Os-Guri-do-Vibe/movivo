import { KnowledgeTacoPanel } from '@/components/dashboard/knowledge-taco';
import { hasAllCapabilities } from '@/lib/control-center-access';

import { requireDashboardCapability } from '../../../_lib/session';

export default async function KnowledgeTacoPage() {
  const session = await requireDashboardCapability(
    'control_center.ai.config.read',
    '/dashboard/ia/base-conhecimento/taco',
  );
  return (
    <KnowledgeTacoPanel
      canImport={hasAllCapabilities(session.capabilities, 'control_center.ai.knowledge.write')}
    />
  );
}

import { KnowledgeMethodologyPanel } from '@/components/dashboard/knowledge-methodology';
import { hasAllCapabilities } from '@/lib/control-center-access';

import { requireDashboardCapability } from '../../_lib/session';

export default async function KnowledgeMethodologyPage() {
  const session = await requireDashboardCapability(
    'control_center.ai.config.read',
    '/dashboard/ia/base-conhecimento',
  );
  return (
    <KnowledgeMethodologyPanel
      canEdit={hasAllCapabilities(session.capabilities, 'control_center.ai.knowledge.write')}
      canApprove={hasAllCapabilities(session.capabilities, 'control_center.ai.methodology.approve')}
    />
  );
}

import { AiKnowledgeDashboard } from '@/components/dashboard/ai-knowledge';
import { hasAllCapabilities } from '@/lib/control-center-access';

import { requireDashboardCapability } from '../../../_lib/session';

export default async function KnowledgeDocumentsPage() {
  const session = await requireDashboardCapability(
    'control_center.ai.config.read',
    '/dashboard/ia/base-conhecimento/documentos',
  );
  return (
    <AiKnowledgeDashboard
      showHeader={false}
      canUpload={hasAllCapabilities(session.capabilities, 'control_center.ai.knowledge.write')}
      canApprove={hasAllCapabilities(session.capabilities, 'control_center.ai.knowledge.approve')}
    />
  );
}

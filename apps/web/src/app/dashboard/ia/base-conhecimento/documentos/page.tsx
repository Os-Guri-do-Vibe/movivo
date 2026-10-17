import { KnowledgeArticlesPanel } from '@/components/dashboard/knowledge-articles';
import { hasAllCapabilities } from '@/lib/control-center-access';

import { requireDashboardCapability } from '../../../_lib/session';

export default async function KnowledgeDocumentsPage() {
  const session = await requireDashboardCapability(
    'control_center.ai.config.read',
    '/dashboard/ia/base-conhecimento/documentos',
  );
  return (
    <KnowledgeArticlesPanel
      canUpload={hasAllCapabilities(session.capabilities, 'control_center.ai.knowledge.write')}
      canApprove={hasAllCapabilities(session.capabilities, 'control_center.ai.knowledge.approve')}
    />
  );
}

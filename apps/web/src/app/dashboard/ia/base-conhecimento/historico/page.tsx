import { KnowledgeHistoryPanel } from '@/components/dashboard/knowledge-history';
import { hasAllCapabilities } from '@/lib/control-center-access';

import { requireDashboardCapability } from '../../../_lib/session';

export default async function KnowledgeHistoryPage() {
  const session = await requireDashboardCapability(
    'control_center.ai.config.read',
    '/dashboard/ia/base-conhecimento/historico',
  );
  return (
    <KnowledgeHistoryPanel
      canReadAudit={hasAllCapabilities(session.capabilities, 'control_center.audit.read')}
    />
  );
}

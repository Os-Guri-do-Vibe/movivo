import { AiFaqDashboard } from '@/components/dashboard/ai-faq';
import { hasAllCapabilities } from '@/lib/control-center-access';

import { requireDashboardCapability } from '../../_lib/session';

export default async function AiFaqPage() {
  const session = await requireDashboardCapability(
    'control_center.ai.config.read',
    '/dashboard/ia/faq',
  );
  return (
    <AiFaqDashboard
      canWrite={hasAllCapabilities(session.capabilities, 'control_center.ai.config.write')}
    />
  );
}

import { MethodologyStudio } from '@/components/dashboard/methodology-studio';

import { requireDashboardCapability } from '../../_lib/session';

export default async function MethodologyStudioPage() {
  await requireDashboardCapability('control_center.ai.config.read', '/dashboard/ia/metodologia');
  return <MethodologyStudio />;
}

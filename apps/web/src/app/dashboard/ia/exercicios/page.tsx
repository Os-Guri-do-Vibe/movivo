import { AiExerciseCatalogDashboard } from '@/components/dashboard/ai-exercise-catalog';
import { hasAllCapabilities } from '@/lib/control-center-access';

import { requireDashboardCapability } from '../../_lib/session';

export default async function AiExerciseCatalogPage() {
  const session = await requireDashboardCapability(
    'control_center.ai.config.read',
    '/dashboard/ia/exercicios',
  );
  return (
    <AiExerciseCatalogDashboard
      canWrite={hasAllCapabilities(session.capabilities, 'control_center.ai.config.write')}
    />
  );
}

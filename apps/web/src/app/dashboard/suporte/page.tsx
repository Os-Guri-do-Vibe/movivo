import { SupportDashboard } from '@/components/dashboard/support-dashboard';

import { requireDashboardCapability } from '../_lib/session';

export default async function SupportPage() {
  await requireDashboardCapability('control_center.support.read', '/dashboard/suporte');
  return <SupportDashboard />;
}

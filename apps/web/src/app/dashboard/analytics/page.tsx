import { MarketingDashboard } from '@/components/dashboard/marketing-dashboard';

import { requireDashboardCapability } from '../_lib/session';

export default async function AnalyticsPage() {
  await requireDashboardCapability('control_center.marketing.read', '/dashboard/analytics');
  return <MarketingDashboard />;
}

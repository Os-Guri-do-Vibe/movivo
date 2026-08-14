import { CampaignsDashboard } from '@/components/dashboard/campaigns-dashboard';

import { requireDashboardCapability } from '../_lib/session';

export default async function CampaignsPage() {
  await requireDashboardCapability('control_center.marketing.read', '/dashboard/campanhas');
  return <CampaignsDashboard />;
}

import { PartnersDashboard } from '@/components/dashboard/partners-dashboard';

import { requireDashboardCapability } from '../_lib/session';

export default async function PartnersPage() {
  await requireDashboardCapability('control_center.partners.read', '/dashboard/socios');
  return <PartnersDashboard />;
}

import type { Metadata } from 'next';

import { DashboardShell } from '@/components/dashboard/dashboard-shell';

import { requireDashboardRole } from './_lib/session';

export const metadata: Metadata = {
  title: 'MOVIVO Control Center',
  robots: { index: false, follow: false, nocache: true },
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireDashboardRole();
  return <DashboardShell {...session}>{children}</DashboardShell>;
}

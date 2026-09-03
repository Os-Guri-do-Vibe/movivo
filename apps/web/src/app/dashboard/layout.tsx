import type { Metadata } from 'next';

import { DashboardShell } from '@/components/dashboard/dashboard-shell';

import { requireDashboardRole } from './_lib/session';

export const metadata: Metadata = {
  // `absolute` ignora o `title.template` (" · MOVIVO") do layout raiz — a aba deve
  // mostrar exatamente "Movivo - Plataforma Interna", sem sufixo.
  title: { absolute: 'Movivo - Plataforma Interna' },
  robots: { index: false, follow: false, nocache: true },
};

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await requireDashboardRole();
  return <DashboardShell {...session}>{children}</DashboardShell>;
}

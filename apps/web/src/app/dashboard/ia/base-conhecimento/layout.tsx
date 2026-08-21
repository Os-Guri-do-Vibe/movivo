import type { Metadata } from 'next';

import { KnowledgeBaseShell } from '@/components/dashboard/knowledge-base-shell';

import { requireDashboardCapability } from '../../_lib/session';

export const metadata: Metadata = {
  title: 'Base de Conhecimento | MOVIVO Control Center',
};

export default async function KnowledgeBaseLayout({ children }: { children: React.ReactNode }) {
  await requireDashboardCapability(
    'control_center.ai.config.read',
    '/dashboard/ia/base-conhecimento',
  );
  return <KnowledgeBaseShell>{children}</KnowledgeBaseShell>;
}

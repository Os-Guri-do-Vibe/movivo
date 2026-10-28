import { methodologyDomainSchema } from '@movivo/shared';
import { notFound } from 'next/navigation';

import { MethodologyStudioEditor } from '@/components/dashboard/methodology-studio-editor';
import { hasAllCapabilities } from '@/lib/control-center-access';

import { requireDashboardCapability } from '../../../_lib/session';

export default async function MethodologyDomainPage({
  params,
}: {
  params: Promise<{ domain: string }>;
}) {
  const { domain: raw } = await params;
  const domain = methodologyDomainSchema.safeParse(raw.toUpperCase());
  if (!domain.success) notFound();
  const session = await requireDashboardCapability(
    'control_center.ai.config.read',
    `/dashboard/ia/metodologia/${raw}`,
  );
  return (
    <MethodologyStudioEditor
      domain={domain.data}
      canEdit={hasAllCapabilities(session.capabilities, 'control_center.ai.methodology.approve')}
    />
  );
}

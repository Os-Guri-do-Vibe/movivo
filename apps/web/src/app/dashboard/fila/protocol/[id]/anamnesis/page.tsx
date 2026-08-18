import { ProtocolAnamnesisAnswers } from '@/components/dashboard/protocol-anamnesis-answers';

import { requireDashboardCapability } from '../../../../_lib/session';

export default async function ProtocolAnamnesisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireDashboardCapability('control_center.students.read', '/dashboard/educacao-fisica');
  const { id } = await params;
  return <ProtocolAnamnesisAnswers protocolId={id} />;
}

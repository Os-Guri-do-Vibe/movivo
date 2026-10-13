import { ConversationsDashboard } from '@/components/dashboard/conversations-dashboard';

import { requireDashboardCapability } from '../_lib/session';

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ aluno?: string }>;
}) {
  // O corpo das mensagens é dado de saúde: `students.health.read` além de `students.read`.
  await requireDashboardCapability(
    ['control_center.students.read', 'control_center.students.health.read'],
    '/dashboard/conversas',
  );
  const { aluno } = await searchParams;
  return <ConversationsDashboard preferredStudentId={aluno} />;
}

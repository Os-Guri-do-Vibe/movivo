import { notFound } from 'next/navigation';

import { QueueDetail } from '@/components/dashboard/queue-detail';
import type { QueueKind } from '@/lib/dashboard-types';

import { requireDashboardCapability } from '../../../_lib/session';

/** `parq` saiu em 2026-08-24 — PAR-Q bloqueante é um `protocol` com `origin: 'PARQ'`. */
const KINDS: Record<string, QueueKind> = {
  protocol: 'PROTOCOL',
  handoff: 'HANDOFF',
  checkin: 'CHECKIN',
  substitution: 'SUBSTITUTION',
};

export default async function QueueDetailPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  await requireDashboardCapability('control_center.students.read', '/dashboard/educacao-fisica');
  const { kind, id } = await params;
  const queueKind = KINDS[kind];
  if (!queueKind) notFound();
  return <QueueDetail kind={queueKind} id={id} />;
}

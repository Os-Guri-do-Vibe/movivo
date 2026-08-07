import { notFound } from 'next/navigation';

import { QueueDetail } from '@/components/dashboard/queue-detail';
import type { QueueKind } from '@/lib/dashboard-types';

const KINDS: Record<string, QueueKind> = {
  protocol: 'PROTOCOL',
  handoff: 'HANDOFF',
  parq: 'PARQ',
  checkin: 'CHECKIN',
};

export default async function QueueDetailPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  const { kind, id } = await params;
  const queueKind = KINDS[kind];
  if (!queueKind) notFound();
  return <QueueDetail kind={queueKind} id={id} />;
}

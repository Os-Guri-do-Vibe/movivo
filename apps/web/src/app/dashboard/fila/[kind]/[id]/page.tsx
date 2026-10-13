import { notFound, redirect } from 'next/navigation';

import { QueueDetail } from '@/components/dashboard/queue-detail';

import { requireDashboardCapability } from '../../../_lib/session';

/** `parq` saiu em 2026-08-24 — PAR-Q bloqueante é um `protocol` com `origin: 'PARQ'`. */
const KINDS: Record<string, 'PROTOCOL' | 'SUBSTITUTION'> = {
  protocol: 'PROTOCOL',
  substitution: 'SUBSTITUTION',
};

export default async function QueueDetailPage({
  params,
}: {
  params: Promise<{ kind: string; id: string }>;
}) {
  await requireDashboardCapability('control_center.students.read', '/dashboard/educacao-fisica');
  const { kind, id } = await params;
  // Alertas e check-ins têm tela própria (`/dashboard/alertas/[id]`); o id do check-in já é o
  // do alerta. O redirecionamento mantém funcionando os links antigos.
  if (kind === 'handoff' || kind === 'checkin')
    redirect(`/dashboard/alertas/${encodeURIComponent(id)}`);
  const queueKind = KINDS[kind];
  if (!queueKind) notFound();
  return <QueueDetail kind={queueKind} id={id} />;
}

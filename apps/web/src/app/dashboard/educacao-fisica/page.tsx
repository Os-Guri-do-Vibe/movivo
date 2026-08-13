import { QueueBoard } from '@/components/dashboard/queue-board';

import { requireDashboardCapability } from '../_lib/session';

export default async function PhysicalEducationPage() {
  // Fila do Profissional: revisão de protocolo, handoff SAFETY e PAR-Q bloqueado são
  // leitura de dado de saúde — exige `students.health.read` além de `students.read`.
  await requireDashboardCapability(
    ['control_center.students.read', 'control_center.students.health.read'],
    '/dashboard/educacao-fisica',
  );
  return <QueueBoard />;
}

import { StudentDetail } from '@/components/dashboard/student-detail';

import { requireDashboardCapability } from '../../_lib/session';

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  // A ficha unificada (US-7.4) abre com `students.read`: cadastro, timeline e adesão são
  // dado operacional. A seção de saúde (PAR-Q, relato de dor, evolução declarada) é
  // filtrada **no backend** por `students.health.read` — o servidor não envia, a UI não
  // esconde. Mesma regra de `GET /control-center/students/:id`.
  await requireDashboardCapability('control_center.students.read', '/dashboard/alunos');
  const { id } = await params;
  return <StudentDetail id={id} />;
}

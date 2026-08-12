import Link from 'next/link';

import { QueueBoard } from '@/components/dashboard/queue-board';

import { requireDashboardCapability } from '../_lib/session';

export default async function PhysicalEducationPage() {
  await requireDashboardCapability('control_center.students.read', '/dashboard/educacao-fisica');
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-end gap-3">
        <Link
          href="/dashboard/operacoes"
          className="inline-flex min-h-11 items-center rounded-lg border border-input px-4 text-label font-semibold hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
        >
          Ver operações CREF
        </Link>
      </div>
      <QueueBoard />
    </div>
  );
}

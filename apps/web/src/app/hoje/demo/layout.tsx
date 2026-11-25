import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { StudentDemo } from '@/components/training/demo/student-demo';
import { studentDemoEnabled } from '@/lib/student-demo';

/** Demonstração do diário com dados de exemplo. Só no ambiente local (404 fora dele). */
export default function StudentDemoLayout({ children }: { children: ReactNode }) {
  if (!studentDemoEnabled()) notFound();
  return <StudentDemo>{children}</StudentDemo>;
}

import type { Metadata } from 'next';

import { DemoTraining } from '@/components/training/demo/student-demo';

export const metadata: Metadata = {
  title: { absolute: 'MOVIVO · Demonstração do diário' },
  robots: { index: false, follow: false, noarchive: true },
};

export default function StudentDemoPage() {
  return <DemoTraining />;
}

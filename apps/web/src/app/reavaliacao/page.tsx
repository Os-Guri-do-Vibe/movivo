import type { Metadata } from 'next';

import { ReassessmentForm } from '@/components/reassessment/reassessment-form';

export const metadata: Metadata = {
  title: { absolute: 'MOVIVO · Reavaliação do ciclo' },
  robots: { index: false, follow: false, noarchive: true },
};

export default function ReassessmentPage() {
  return <ReassessmentForm />;
}

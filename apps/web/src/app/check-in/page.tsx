import type { Metadata } from 'next';

import { CheckInForm } from '@/components/checkin/check-in-form';

export const metadata: Metadata = {
  title: { absolute: 'MOVIVO · Check-in da semana' },
  robots: { index: false, follow: false, noarchive: true },
};

export default function CheckInPage() {
  return <CheckInForm />;
}

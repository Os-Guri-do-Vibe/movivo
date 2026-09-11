import type { Metadata } from 'next';

import { WorkoutJournalView } from '@/components/workout/workout-journal';

export const metadata: Metadata = {
  title: { absolute: 'Movivo - Check-in Diário' },
  robots: { index: false, follow: false, noarchive: true },
};

export default function WorkoutPage() {
  return <WorkoutJournalView />;
}

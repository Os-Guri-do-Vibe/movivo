import type { Metadata } from 'next';

import { WorkoutJournalView } from '@/components/workout/workout-journal';

export const metadata: Metadata = {
  title: 'Meu treino',
  robots: { index: false, follow: false, noarchive: true },
};

export default function WorkoutPage() {
  return <WorkoutJournalView />;
}

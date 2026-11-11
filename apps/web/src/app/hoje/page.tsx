import type { Metadata } from 'next';

import { TrainingDayView } from '@/components/training/training-day-view';

export const metadata: Metadata = {
  title: { absolute: 'MOVIVO · Seu treino de hoje' },
  robots: { index: false, follow: false, noarchive: true },
};

export default async function TrainingPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date } = await searchParams;
  return <TrainingDayView date={date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined} />;
}

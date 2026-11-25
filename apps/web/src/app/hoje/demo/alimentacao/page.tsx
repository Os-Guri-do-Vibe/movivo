import type { Metadata } from 'next';

import { FoodDayView } from '@/components/nutrition/food-day-view';

export const metadata: Metadata = {
  title: { absolute: 'MOVIVO · Demonstração da alimentação' },
  robots: { index: false, follow: false, noarchive: true },
};

export default function DemoFoodPage() {
  return <FoodDayView />;
}

import type { Metadata } from 'next';

import { EvolutionView } from '@/components/evolution/evolution-view';

export const metadata: Metadata = {
  title: { absolute: 'MOVIVO · Demonstração da evolução' },
  robots: { index: false, follow: false, noarchive: true },
};

export default function DemoEvolutionPage() {
  return <EvolutionView />;
}

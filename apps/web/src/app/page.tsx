import type { Metadata, Viewport } from 'next';

import { Landing } from '@/components/landing/landing';

export const metadata: Metadata = {
  title: { absolute: 'Movivo - Assessoria de Treino' },
  description:
    'Treino individualizado, acompanhamento contínuo e respaldo profissional direto no WhatsApp. Experimente a MOVIVO por 7 dias grátis.',
  alternates: { canonical: '/' },
};

export const viewport: Viewport = {
  themeColor: '#03110e',
};

export default function HomePage() {
  return <Landing />;
}

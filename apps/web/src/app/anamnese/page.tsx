import type { Metadata } from 'next';

import { AnamneseEntry } from '@/components/onboarding/anamnese-entry';

/**
 * Onboarding v2 (US-6.10/US-6.11). A sessão é criada ou retomada no cliente, pelo BFF, e
 * o token nunca aparece na URL nem no JavaScript da página — ver `AnamneseEntry`.
 */
export const metadata: Metadata = {
  title: { absolute: 'Movivo - Anamnese' },
  robots: { index: false },
};

export default function AnamnesePage() {
  return <AnamneseEntry />;
}

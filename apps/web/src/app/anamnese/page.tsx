import type { Metadata } from 'next';
import { connection } from 'next/server';

import { AnamneseEntry } from '@/components/onboarding/anamnese-entry';

/**
 * Onboarding v2 (US-6.10/US-6.11). A sessão é criada ou retomada no cliente, pelo BFF, e
 * o token nunca aparece na URL nem no JavaScript da página — ver `AnamneseEntry`.
 */
export const metadata: Metadata = {
  title: { absolute: 'Movivo - Anamnese' },
  robots: { index: false },
};

export default async function AnamnesePage() {
  // Recebe CSP com nonce pelo proxy. Sem renderização por request, o build estático
  // emite scripts sem nonce e o formulário não hidrata.
  await connection();
  return <AnamneseEntry />;
}

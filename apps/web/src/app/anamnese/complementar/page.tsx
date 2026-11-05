import type { Metadata } from 'next';
import { connection } from 'next/server';

import { ComplementaryEntry } from '@/components/onboarding/complementary-entry';

export const metadata: Metadata = {
  title: { absolute: 'Movivo - Complete seu perfil' },
  robots: { index: false },
};

export default async function ComplementaryAnamnesisPage() {
  // Mesmo motivo de `/anamnese`: renderização por request para receber o nonce da CSP.
  await connection();
  return <ComplementaryEntry />;
}

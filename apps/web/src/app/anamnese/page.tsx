import type { Metadata } from 'next';

import { AnamneseForm } from '@/components/anamnese/anamnese-form';

/**
 * Rota `/anamnese` (US-1.6) — casca RSC. Toda a interatividade (fluxo de 3 blocos,
 * consentimento, PAR-Q, confirmação) vive no client component `AnamneseForm`.
 *
 * O `?goal=` vem da landing (US-1.5) como valor inicial/telemetria; ausente não quebra.
 * `searchParams` é assíncrono no App Router do Next 16.
 */
export const metadata: Metadata = {
  title: 'Sua anamnese · MOVIVO',
  robots: { index: false },
};

export default async function AnamnesePage({
  searchParams,
}: {
  searchParams: Promise<{ goal?: string }>;
}) {
  const { goal } = await searchParams;
  return <AnamneseForm goal={goal ?? null} />;
}

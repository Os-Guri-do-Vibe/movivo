import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { LegalPage } from '@/components/legal/legal-page';
import { loadLegalDocument } from '@/lib/legal-documents';
import { LEGAL_RELEASE } from '@/lib/legal-release';

export const metadata: Metadata = {
  title: 'Termos de Uso',
  description: 'Termos de Uso da MOVIVO.',
  alternates: { canonical: '/termos' },
  robots: LEGAL_RELEASE.checkoutApproved ? undefined : { index: false, follow: false },
};

export default function TermsPage() {
  const document = loadLegalDocument('terms');
  if (!document) notFound();
  return <LegalPage title="Termos de Uso" document={document} />;
}

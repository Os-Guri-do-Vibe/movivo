import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { LegalPage } from '@/components/legal/legal-page';
import { loadLegalDocument } from '@/lib/legal-documents';
import { LEGAL_RELEASE } from '@/lib/legal-release';

export const metadata: Metadata = {
  title: 'Política de Privacidade',
  description: 'Política de Privacidade da MOVIVO.',
  alternates: { canonical: '/privacidade' },
  robots: LEGAL_RELEASE.checkoutApproved ? undefined : { index: false, follow: false },
};

export default function PrivacyPage() {
  const document = loadLegalDocument('privacy');
  if (!document) notFound();
  return <LegalPage title="Política de Privacidade" document={document} />;
}

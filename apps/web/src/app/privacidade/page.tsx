import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { LegalPage } from '@/components/legal/legal-page';
import { loadLegalDocument } from '@/lib/legal-documents';

export const metadata: Metadata = {
  title: 'Política de Privacidade',
  description: 'Política de Privacidade da MOVIVO.',
  alternates: { canonical: '/privacidade' },
};

export default function PrivacyPage() {
  const document = loadLegalDocument('privacy');
  if (!document) notFound();
  return <LegalPage title="Política de Privacidade" document={document} />;
}

import type { Metadata, Viewport } from 'next';

import { Landing } from '@/components/landing/landing';
import { HOME_DESCRIPTION, HOME_TITLE, SITE_NAME } from '@/lib/landing/seo';

export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: HOME_DESCRIPTION,
  alternates: { canonical: '/' },
  /* A imagem vem do arquivo `opengraph-image.jpg` desta pasta (convenção do Next). */
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    siteName: SITE_NAME,
    url: '/',
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    title: HOME_TITLE,
    description: HOME_DESCRIPTION,
  },
};

export const viewport: Viewport = {
  themeColor: '#03110e',
};

export default function HomePage() {
  return <Landing />;
}

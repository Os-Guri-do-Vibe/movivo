import type { Metadata } from 'next';
import { Clock } from 'lucide-react';

import { SubscriptionFrame } from '@/components/assinatura/subscription-frame';
import { AccessLinkForm, RenewLinkButton } from '@/components/conta/access-link-form';

import styles from '../conta/[token]/page.module.css';

export const metadata: Metadata = {
  title: 'Link expirado',
  robots: { index: false, follow: false },
};

const CODE_PATTERN = /^[A-Za-z0-9]{24}$/;

/** Destino dos links curtos vencidos (`/checkout/<código>` e `/cancelar/<código>`). */
export default async function LinkExpiradoPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string | string[] }>;
}) {
  const { c } = await searchParams;
  const code = typeof c === 'string' && CODE_PATTERN.test(c) ? c : null;

  return (
    <SubscriptionFrame
      secureLabel="Área da assinatura"
      footerLead="Gestão protegida da sua assinatura MOVIVO."
    >
      <section className={styles.emptyCard} aria-labelledby="expirado-title">
        <Clock aria-hidden="true" />
        <p>Link expirado</p>
        <h1 id="expirado-title">Esse link não vale mais</h1>
        <span>
          Por segurança, os links têm prazo de validade. Receba um novo no seu WhatsApp, é rápido.
        </span>
        {code ? <RenewLinkButton code={code} /> : <AccessLinkForm />}
      </section>
    </SubscriptionFrame>
  );
}

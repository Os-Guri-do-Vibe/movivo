import type { Metadata } from 'next';
import { MessageCircle } from 'lucide-react';

import { SubscriptionFrame } from '@/components/assinatura/subscription-frame';
import { AccessLinkForm } from '@/components/conta/access-link-form';

import styles from './[token]/page.module.css';

export const metadata: Metadata = {
  title: 'Gerenciar assinatura',
  description: 'Receba no WhatsApp o link para gerenciar ou cancelar sua assinatura MOVIVO.',
  robots: { index: false, follow: false },
};

/** Entrada pública sem token: o link novo vai só para o WhatsApp do número cadastrado. */
export default function ContaEntradaPage() {
  return (
    <SubscriptionFrame
      secureLabel="Área da assinatura"
      footerLead="Gestão protegida da sua assinatura MOVIVO."
    >
      <section className={styles.emptyCard} aria-labelledby="entrada-title">
        <MessageCircle aria-hidden="true" />
        <p>Gerenciar assinatura</p>
        <h1 id="entrada-title">Receba seu link no WhatsApp</h1>
        <span>
          Informe o celular que você usa com a MOVIVO. Enviamos um link seguro para gerenciar ou
          cancelar a assinatura, sem burocracia.
        </span>
        <AccessLinkForm />
      </section>
    </SubscriptionFrame>
  );
}

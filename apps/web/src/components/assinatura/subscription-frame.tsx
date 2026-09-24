import type { ReactNode } from 'react';
import Link from 'next/link';
import { ArrowLeft, LockKeyhole } from 'lucide-react';

import { landingFontVariables } from '@/components/landing/fonts';
import { MovivoLogo } from '@/components/landing/ui/movivo-logo';
import { CONTACT_URL, LEGAL_LINKS } from '@/lib/landing/site';

import styles from './subscription-frame.module.css';

export function SubscriptionFrame({
  children,
  secureLabel = 'Ambiente seguro',
  footerLead = 'Pagamento processado com segurança pelo Asaas.',
}: {
  children: ReactNode;
  secureLabel?: string;
  footerLead?: string;
}) {
  return (
    <div className={`protocolo-light ${landingFontVariables} ${styles.shell}`}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <Link href="/" className={styles.back} aria-label="Voltar para a página inicial">
            <ArrowLeft aria-hidden="true" />
          </Link>
          <MovivoLogo className={styles.logo} />
          <p className={styles.secureLabel}>
            <LockKeyhole aria-hidden="true" /> {secureLabel}
          </p>
        </div>
      </header>

      <main id="conteudo" className={styles.main}>
        {children}
      </main>

      <footer className={styles.footer}>
        <p>{footerLead}</p>
        <nav aria-label="Links legais e suporte">
          {CONTACT_URL ? <a href={CONTACT_URL}>Suporte</a> : null}
          {LEGAL_LINKS.terms ? <a href={LEGAL_LINKS.terms}>Termos</a> : null}
          {LEGAL_LINKS.privacy ? <a href={LEGAL_LINKS.privacy}>Privacidade</a> : null}
        </nav>
        <p>Orientação supervisionada por profissional de Educação Física registrado no CREF.</p>
      </footer>
    </div>
  );
}

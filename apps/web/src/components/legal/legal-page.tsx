import Link from 'next/link';
import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { landingFontVariables } from '@/components/landing/fonts';
import { MovivoLogo } from '@/components/landing/ui/movivo-logo';
import type { LegalDocument } from '@/lib/legal-documents';

import styles from './legal-page.module.css';

export function LegalPage({ title, document }: { title: string; document: LegalDocument }) {
  return (
    <div className={`${landingFontVariables} ${styles.shell}`}>
      <a className={styles.skipLink} href="#conteudo">
        Ir para o conteúdo
      </a>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.logoLink} aria-label="MOVIVO — página inicial">
            <MovivoLogo className={styles.logo} />
          </Link>
          <span className={styles.headerLabel}>Documentos legais</span>
        </div>
      </header>

      <main id="conteudo" className={styles.main}>
        <Link href="/" className={styles.backLink}>
          <ArrowLeft aria-hidden="true" size={18} /> Voltar para a página inicial
        </Link>
        <div className={styles.intro}>
          <p className={styles.eyebrow}>MOVIVO · Transparência</p>
          <h1>{title}</h1>
          {document.status === 'BETA_VISIBLE' ? (
            <div className={styles.betaNotice} role="note">
              <strong>Versão beta para consulta.</strong> CNPJ, registros CREF, canais de contato e
              outros dados indicados entre colchetes ainda estão pendentes. Este texto será
              atualizado antes da operação comercial definitiva.
            </div>
          ) : null}
          <p className={styles.meta}>
            Versão {document.version}
            {document.effectiveOn ? (
              <>
                {' '}
                · Vigência a partir de{' '}
                <time dateTime={document.effectiveOn}>
                  {new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(
                    new Date(`${document.effectiveOn}T00:00:00Z`),
                  )}
                </time>
              </>
            ) : (
              ' · Minuta beta sem data de vigência definida'
            )}
          </p>
        </div>

        <article className={styles.document} aria-label={title}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => <h2>{children}</h2>,
              a: ({ href, children }) => {
                const external = href?.startsWith('https://') || href?.startsWith('http://');
                return (
                  <a
                    href={href}
                    target={external ? '_blank' : undefined}
                    rel={external ? 'noopener noreferrer' : undefined}
                  >
                    {children}
                    {external ? <ArrowUpRight aria-hidden="true" size={14} /> : null}
                  </a>
                );
              },
            }}
          >
            {document.markdown}
          </ReactMarkdown>
        </article>
      </main>

      <footer className={styles.footer}>
        <span>© {new Date().getFullYear()} MOVIVO</span>
        <Link href="/">Página inicial</Link>
      </footer>
    </div>
  );
}

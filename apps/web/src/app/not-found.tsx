import type { Metadata } from 'next';
import Link from 'next/link';

import { landingFontVariables } from '@/components/landing/fonts';
import { MovivoLogo } from '@/components/landing/ui/movivo-logo';

import styles from './not-found.module.css';

export const metadata: Metadata = {
  title: 'Página não encontrada',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <main className={`${styles.page} ${landingFontVariables}`}>
      <div className={styles.glow} aria-hidden="true" />
      <header className={styles.header}>
        <Link href="/" aria-label="MOVIVO — ir para o início" className={styles.brand}>
          <MovivoLogo title={null} />
        </Link>
        <span className={styles.headerLabel}>Ciência que treina com você.</span>
      </header>

      <section className={styles.content} aria-labelledby="not-found-title">
        <div className={styles.number} aria-hidden="true">
          404
        </div>
        <div className={styles.pulse} aria-hidden="true">
          <span />
          <svg viewBox="0 0 100 28" fill="none" preserveAspectRatio="none">
            <path
              d="M0 14H29L37 14L44 3L51 25L59 14H100"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
          <span />
        </div>
        <p className={styles.eyebrow}>PÁGINA NÃO ENCONTRADA</p>
        <h1 id="not-found-title">Essa rota saiu do treino.</h1>
        <p className={styles.description}>
          O endereço que você tentou acessar não existe. Vamos colocar você de volta no caminho.
        </p>
        <Link href="/" className={styles.cta}>
          Voltar ao início <span aria-hidden="true">↗</span>
        </Link>
      </section>

      <footer className={styles.footer}>
        <span>MOVIVO © {new Date().getFullYear()}</span>
        <span>Treinos com supervisão de profissional de Educação Física registrado no CREF.</span>
      </footer>
    </main>
  );
}

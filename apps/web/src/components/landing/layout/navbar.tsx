'use client';

import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

import { cn } from '@/lib/utils';
import { LANDING_EVENTS } from '@/lib/landing/analytics';
import { NAV_LINKS, SECTION_IDS } from '@/lib/landing/site';

import { MovivoLogo } from '../ui/movivo-logo';
import { TrialCta } from '../ui/pulse-button';
import { useLandingPortal } from '../ui/use-landing-portal';

import styles from './navbar.module.css';

const SCROLLED_AT = 80;

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const pendingTarget = useRef<string | null>(null);
  const portal = useLandingPortal();

  useEffect(() => {
    let frame = 0;
    function update() {
      frame = 0;
      setScrolled(window.scrollY > SCROLLED_AT);
    }
    function onScroll() {
      if (!frame) frame = window.requestAnimationFrame(update);
    }
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  /*
   * Âncora dentro do menu: fecha o diálogo primeiro e só rola quando o scroll-lock do
   * Radix já foi removido. O foco vai para a seção de destino, não de volta ao botão.
   */
  function handleMenuClick(event: MouseEvent<HTMLElement>) {
    const anchor = (event.target as HTMLElement).closest('a');
    const href = anchor?.getAttribute('href');
    if (!href) return;
    if (href.startsWith('#')) {
      event.preventDefault();
      pendingTarget.current = href.slice(1);
    }
    setMenuOpen(false);
  }

  function handleCloseAutoFocus(event: Event) {
    const id = pendingTarget.current;
    if (!id) return;
    pendingTarget.current = null;
    event.preventDefault();
    const target = document.getElementById(id);
    if (!target) return;
    window.history.pushState(null, '', `#${id}`);
    target.scrollIntoView({ block: 'start' });
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }

  return (
    <header className={cn(styles.navbar, scrolled && styles.scrolled)} data-scrolled={scrolled}>
      <div className={styles.inner}>
        <a href={`#${SECTION_IDS.top}`} className={styles.brand} aria-label="MOVIVO — início">
          <MovivoLogo className={styles.logo} title={null} />
        </a>

        <nav className={styles.links} aria-label="Navegação principal">
          {NAV_LINKS.map((link) => (
            <a key={link.href} href={link.href} className={styles.link}>
              {link.label}
            </a>
          ))}
        </nav>

        <div className={styles.actions}>
          <TrialCta
            event={LANDING_EVENTS.navStartTrial}
            size="compact"
            arrow={false}
            className={styles.cta}
          >
            Começar grátis
          </TrialCta>

          <Dialog.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <Dialog.Trigger className={styles.menuButton} aria-label="Abrir menu">
              <span className={styles.menuIcon} aria-hidden="true">
                <span />
                <span />
              </span>
            </Dialog.Trigger>
            <Dialog.Portal container={portal}>
              <Dialog.Overlay className={styles.menuOverlay} />
              <Dialog.Content
                className={styles.menu}
                aria-describedby={undefined}
                onCloseAutoFocus={handleCloseAutoFocus}
              >
                <div className={styles.menuHeader}>
                  <Dialog.Title className={styles.menuTitle}>Menu</Dialog.Title>
                  <Dialog.Close className={styles.menuClose} aria-label="Fechar menu">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </Dialog.Close>
                </div>
                <nav
                  className={styles.menuNav}
                  aria-label="Navegação mobile"
                  onClickCapture={handleMenuClick}
                >
                  {NAV_LINKS.map((link, index) => (
                    <a
                      key={link.href}
                      href={link.href}
                      className={styles.menuLink}
                      style={{ '--i': index } as CSSProperties}
                    >
                      <span className={styles.menuIndex}>{String(index + 1).padStart(2, '0')}</span>
                      {link.label}
                    </a>
                  ))}
                </nav>
                <div className={styles.menuFooter} onClickCapture={handleMenuClick}>
                  <TrialCta event={LANDING_EVENTS.navStartTrial} width="full">
                    Começar 7 dias grátis
                  </TrialCta>
                  <p className={styles.menuNote}>Sem cobrança durante o período de teste.</p>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </div>
    </header>
  );
}

import { cn } from '@/lib/utils';
import { LANDING_EVENTS } from '@/lib/landing/analytics';
import {
  CONTACT_URL,
  FOOTER_COLUMNS,
  LEGAL_LINKS,
  RESPONSIBLE_PROFESSIONAL,
  SECTION_IDS,
  SOCIAL,
  crefLabel,
} from '@/lib/landing/site';

import landing from '../landing.module.css';
import { SectionMotion } from '../motion/section-motion';
import { MovivoLogo, MovivoWordmark } from '../ui/movivo-logo';
import { TrialCta } from '../ui/pulse-button';

import styles from './footer.module.css';

const GLASS_FILTER_ID = 'movivo-glass-effect';

/** Glifo do Instagram em traço, no mesmo desenho dos ícones Lucide da landing. */
function InstagramMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.6" className={styles.socialDot} />
    </svg>
  );
}

function externalProps(href: string) {
  return href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {};
}

/*
 * Vidro da assinatura: sombra externa + brilho interno de cima + sombra interna nas bordas,
 * aplicados ao lettering branco sobre a Névoa. Os valores ficam em px porque o filtro é
 * referenciado por CSS num elemento HTML.
 */
function GlassFilter() {
  return (
    <svg className={styles.filterDefs} aria-hidden="true" focusable="false">
      <defs>
        <filter id={GLASS_FILTER_ID} x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow
            dx="0"
            dy="4"
            stdDeviation="6"
            floodColor="#14201c"
            floodOpacity="0.25"
            result="outer-shadow"
          />
          <feComponentTransfer in="SourceAlpha" result="alpha">
            <feFuncA type="linear" slope="1" />
          </feComponentTransfer>
          <feOffset in="alpha" dx="0" dy="4" result="offset-white" />
          <feGaussianBlur in="offset-white" stdDeviation="4" result="blur-white" />
          <feComposite in="alpha" in2="blur-white" operator="out" result="inner-white-mask" />
          <feFlood floodColor="#ffffff" floodOpacity="0.25" result="white-fill" />
          <feComposite in="white-fill" in2="inner-white-mask" operator="in" result="inner-white" />
          <feGaussianBlur in="alpha" stdDeviation="6" result="blur-black" />
          <feComposite in="alpha" in2="blur-black" operator="out" result="inner-black-mask" />
          <feFlood floodColor="#14201c" floodOpacity="0.25" result="black-fill" />
          <feComposite in="black-fill" in2="inner-black-mask" operator="in" result="inner-black" />
          <feMerge>
            <feMergeNode in="outer-shadow" />
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="inner-white" />
            <feMergeNode in="inner-black" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}

/**
 * Rodapé em cartões sobrepostos: um corpo Névoa mais escuro abraça o cartão branco com a
 * marca, o respaldo CREF e a navegação; a barra legal fica no corpo, fora do cartão.
 * Embaixo, a assinatura "movivo" gigante em vidro, com o lettering oficial.
 */
export function Footer() {
  const legal = [
    { label: 'Termos de uso', href: LEGAL_LINKS.terms },
    { label: 'Privacidade', href: LEGAL_LINKS.privacy },
    { label: 'Contato', href: CONTACT_URL },
  ].filter((link): link is { label: string; href: string } => link.href !== null);

  return (
    <footer id="rodape" className={cn(styles.footer, landing.themeLight)}>
      <div className={landing.container}>
        <div className={styles.shell}>
          <div className={styles.card}>
            <div className={styles.brand}>
              <a
                href={`#${SECTION_IDS.top}`}
                className={styles.logoLink}
                aria-label="MOVIVO — voltar ao topo"
              >
                <MovivoLogo className={styles.logo} title={null} />
              </a>
              <p className={styles.description}>
                Ciência que treina com você: treino individualizado no WhatsApp, com método e
                supervisão de um profissional de Educação Física.
              </p>
              <p className={styles.professional}>
                Responsável técnico: {RESPONSIBLE_PROFESSIONAL.name} ·{' '}
                {RESPONSIBLE_PROFESSIONAL.profession} · {crefLabel(RESPONSIBLE_PROFESSIONAL)}
              </p>
              <div className={styles.actions}>
                <a
                  href={SOCIAL.instagram.url}
                  className={styles.social}
                  aria-label={`Instagram ${SOCIAL.instagram.handle}`}
                  {...externalProps(SOCIAL.instagram.url)}
                >
                  <InstagramMark className={styles.socialIcon} />
                </a>
                <TrialCta event={LANDING_EVENTS.footerStartTrial} size="compact">
                  Começar grátis
                </TrialCta>
              </div>
            </div>

            <nav className={styles.columns} aria-label="Rodapé">
              {FOOTER_COLUMNS.map((column) => (
                <div key={column.title} className={styles.column}>
                  <h2 className={styles.columnTitle}>{column.title}</h2>
                  <ul className={styles.columnLinks}>
                    {column.links.map((link) => (
                      <li key={link.href}>
                        <a href={link.href}>{link.label}</a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          </div>

          <div className={styles.legal}>
            <p>© {new Date().getFullYear()} MOVIVO. Todos os direitos reservados.</p>
            {legal.length ? (
              <ul className={styles.legalLinks}>
                {legal.map((link) => (
                  <li key={link.label}>
                    <a href={link.href} {...externalProps(link.href)}>
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        <SectionMotion effect="footer" className={styles.glass}>
          <GlassFilter />
          <div className={styles.glassWord} data-footer-glass="">
            <MovivoWordmark className={styles.wordmark} />
          </div>
        </SectionMotion>
      </div>
    </footer>
  );
}

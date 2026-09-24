'use client';

import * as Dialog from '@radix-ui/react-dialog';

import { cn } from '@/lib/utils';
import { RESPONSIBLE_PROFESSIONAL, crefLabel, type Credential } from '@/lib/landing/site';

import { useLandingPortal } from '../ui/use-landing-portal';

import styles from './intelligence-human.module.css';

/** Área à esquerda, grau e situação à direita; "em andamento" fica mais discreto. */
function CredentialList({ items }: { items: readonly Credential[] }) {
  return (
    <ul className={styles.drawerList}>
      {items.map((item) => (
        <li key={item.area}>
          <span className={styles.drawerArea}>{item.area}</span>
          <span className={cn(styles.drawerDegree, item.inProgress && styles.drawerInProgress)}>
            {item.degree}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Formação completa do Responsável Técnico em um drawer (ESC, foco preso, retorno do foco). */
export function LeonardoDetails() {
  const portal = useLandingPortal();
  const professional = RESPONSIBLE_PROFESSIONAL;

  return (
    <Dialog.Root>
      <Dialog.Trigger className={styles.detailsButton}>
        Formação e trajetória
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M4 10h11.5M11 5.5 15.5 10 11 14.5" />
        </svg>
      </Dialog.Trigger>
      <Dialog.Portal container={portal}>
        <Dialog.Overlay className={styles.drawerOverlay} />
        <Dialog.Content className={styles.drawer}>
          <div className={styles.drawerHeader}>
            <div>
              <p className={styles.drawerEyebrow}>{professional.position}</p>
              <Dialog.Title className={styles.drawerTitle}>{professional.fullName}</Dialog.Title>
              <Dialog.Description className={styles.drawerDescription}>
                {professional.profession} · {crefLabel(professional)}
              </Dialog.Description>
            </div>
            <Dialog.Close className={styles.drawerClose} aria-label="Fechar">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </Dialog.Close>
          </div>

          <p className={styles.drawerLead}>{professional.tagline}</p>
          <p className={styles.drawerSummary}>{professional.bio}</p>

          <section className={styles.drawerSection}>
            <h3 className={styles.drawerHeading}>Formação acadêmica</h3>
            <CredentialList items={professional.education} />
          </section>

          <section className={styles.drawerSection}>
            <h3 className={styles.drawerHeading}>Especialização</h3>
            <CredentialList items={professional.specialization} />
          </section>

          <section className={styles.drawerSection}>
            <h3 className={styles.drawerHeading}>Da teoria para a prática</h3>
            <p className={styles.drawerStat}>
              <strong>{professional.practice.years}</strong>
              <span>{professional.practice.label}</span>
            </p>
            <p className={styles.drawerSummary}>{professional.practice.text}</p>
            <ul className={styles.drawerTags} aria-label="Trajetória esportiva">
              {professional.sport.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>

          <section className={styles.drawerSection}>
            <h3 className={styles.drawerHeading}>Professor e formador</h3>
            <p className={styles.drawerSummary}>{professional.teaching}</p>
            <blockquote className={styles.drawerQuote}>
              <p>“{professional.motto}”</p>
            </blockquote>
          </section>

          <section className={styles.drawerSection}>
            <h3 className={styles.drawerHeading}>Método</h3>
            <ol className={styles.drawerPillars}>
              {professional.pillars.map((pillar) => (
                <li key={pillar}>{pillar}</li>
              ))}
            </ol>
            <p className={styles.drawerSummary}>{professional.pillarsNote}</p>
          </section>

          <p className={styles.drawerNote}>
            Medicina e Nutrição estão em andamento: na MOVIVO, a atuação do Leonardo é como
            profissional de Educação Física, responsável pela metodologia de treino.
          </p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

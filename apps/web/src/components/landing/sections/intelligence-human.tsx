import { cn } from '@/lib/utils';
import { movivoAssets } from '@/lib/landing/assets';
import { RESPONSIBLE_PROFESSIONAL, SECTION_IDS, crefLabel } from '@/lib/landing/site';

import landing from '../landing.module.css';
import { SectionMotion } from '../motion/section-motion';
import { MediaSlot } from '../ui/media-slot';

import styles from './intelligence-human.module.css';
import { LeonardoDetails } from './leonardo-details';

const INTELLIGENCE = [
  { title: 'Personalização', text: 'Cada protocolo parte do seu contexto.' },
  { title: 'Contexto', text: 'Rotina, feedbacks e histórico conectados.' },
  { title: 'Adaptação', text: 'Ajustes quando a sua rotina muda.' },
  { title: 'Disponibilidade', text: 'Respostas no WhatsApp, quando você precisar.' },
] as const;

const HUMAN = [
  { title: 'Metodologia', text: 'Critérios definidos por profissional de Educação Física.' },
  { title: 'Revisão', text: 'Protocolos revisados antes de chegar até você.' },
  { title: 'Supervisão', text: 'Exceções e casos sensíveis seguem para avaliação humana.' },
  { title: 'Responsabilidade técnica', text: 'Um responsável técnico com registro no CREF.' },
] as const;

function ItemList({ items }: { items: readonly { title: string; text: string }[] }) {
  return (
    <ul className={styles.items}>
      {items.map((item, index) => (
        <li key={item.title} className={styles.item} data-reveal="">
          <span className={styles.itemIndex}>{String(index + 1).padStart(2, '0')}</span>
          <span>
            <strong>{item.title}</strong>
            <span className={styles.itemText}>{item.text}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function IntelligenceHuman() {
  const professional = RESPONSIBLE_PROFESSIONAL;
  return (
    <section
      id={SECTION_IDS.technology}
      className={styles.intel}
      aria-labelledby="intel-title"
      data-section-view="human"
    >
      <h2 id="intel-title" className="sr-only">
        Inteligência e respaldo humano
      </h2>
      <SectionMotion effect="intelligence" className={styles.split}>
        <div className={cn(landing.themeLight, styles.side, styles.sideA)} data-side="a">
          <div className={styles.sideInner}>
            <p className={landing.eyebrow}>Inteligência</p>
            <h3 className={cn(landing.h3, styles.sideTitle)} data-reveal="">
              Tecnologia para entender padrões e responder mais rápido.
            </h3>
            <ItemList items={INTELLIGENCE} />
          </div>
        </div>

        <div className={cn(landing.themeGraphite, styles.side, styles.sideB)} data-side="b">
          <div className={styles.sideInner}>
            <p className={landing.eyebrow}>Expertise Humana</p>
            <h3 className={cn(landing.h3, styles.sideTitle)} data-reveal="">
              Conhecimento profissional para dar método, critério e responsabilidade.
            </h3>
            <ItemList items={HUMAN} />
          </div>
        </div>

        {/* Responsável técnico centrado entre as duas metades. */}
        <div className={styles.leoRow}>
          <article className={styles.leo} aria-labelledby="leo-name" data-reveal="">
            <MediaSlot
              asset={movivoAssets.people.leonardo}
              aspectRatio="4 / 5"
              fallbackVariant="portrait"
              monogram="L"
              alt={`${professional.name}, ${professional.role.toLowerCase()} da MOVIVO`}
              sizes="(min-width: 1024px) 220px, 36vw"
              className={styles.leoPortrait}
            />
            <div className={styles.leoInfo}>
              <p id="leo-name" className={styles.leoName}>
                {professional.name}
              </p>
              <p className={styles.leoRole}>{professional.role}</p>
              <p className={styles.leoCred}>
                {professional.profession} · {crefLabel(professional)}
              </p>
              <p className={styles.leoSummary}>{professional.summary}</p>
              <LeonardoDetails />
            </div>
          </article>
        </div>

        <div className={cn(landing.themeDeep, styles.converge)}>
          <span className={styles.seam} aria-hidden="true" data-seam="" />
          <div className={cn(landing.container, styles.convergeInner)}>
            <p className={styles.together} lang="en" data-together="">
              Better together.
            </p>
            <p
              className={cn(landing.lead, landing.secondaryText, styles.convergeText)}
              data-reveal=""
            >
              A MOVIVO não escolhe entre tecnologia e pessoas. Usa cada uma onde ela é mais forte.
            </p>
          </div>
        </div>
      </SectionMotion>
    </section>
  );
}

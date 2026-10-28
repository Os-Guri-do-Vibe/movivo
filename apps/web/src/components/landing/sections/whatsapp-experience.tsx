import { ClipboardPen, MessageCircleMore } from 'lucide-react';
import type { SVGProps } from 'react';

import { cn } from '@/lib/utils';
import { SECTION_IDS } from '@/lib/landing/site';

import landing from '../landing.module.css';
import { SectionMotion } from '../motion/section-motion';
import { MovivoSymbol } from '../ui/movivo-logo';
import { RevealLines } from '../ui/reveal-lines';

import { WhatsAppAurora } from './whatsapp-aurora';
import styles from './whatsapp-experience.module.css';

type ChatItem = {
  kind: 'in' | 'out';
  /** Parágrafos da mensagem. */
  text: readonly string[];
  time: string;
};

/*
 * Conversa ilustrativa: o link da sessão do dia chega no WhatsApp e a MOVIVO explica o plano.
 * Sem promessa de resultado; o respaldo profissional (guardrail do produto) fica visível nas
 * seções How it works e IA + humano.
 */
const CONVERSATION: readonly ChatItem[] = [
  {
    kind: 'in',
    text: [
      'Seu plano está pronto. 💚',
      'Montamos o seu plano considerando seus objetivos, sua rotina, sua disponibilidade e tudo o que você compartilhou com a gente.',
    ],
    time: '07:02',
  },
  { kind: 'out', text: ['Como está estruturada a minha semana, pode me explicar?'], time: '07:15' },
  {
    kind: 'in',
    text: [
      'Claro! Você treina quatro vezes por semana: duas sessões de força e duas de corrida leve, com a alimentação organizada em volta delas.',
      'O treino de hoje está no seu link. Se a rotina apertar, é só me avisar que a gente reorganiza a semana.',
    ],
    time: '07:16',
  },
];

/*
 * Glifo do WhatsApp (Simple Icons, CC0). Ocupa o viewBox inteiro; a margem de 2 unidades
 * iguala o tamanho óptico ao dos ícones Lucide ao lado.
 */
function WhatsAppMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="-2 -2 28 28" fill="currentColor" {...props}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
    </svg>
  );
}

const BENEFITS = [
  { text: 'Sessão do dia no WhatsApp.', Icon: WhatsAppMark },
  { text: 'Dúvidas quando surgirem.', Icon: MessageCircleMore },
  { text: 'Ajustes quando forem necessários.', Icon: ClipboardPen },
] as const;

export function WhatsAppExperience() {
  return (
    <section
      id={SECTION_IDS.whatsapp}
      className={cn(landing.themeDark, styles.whatsapp)}
      aria-labelledby="whatsapp-title"
      data-section-view="whatsapp"
    >
      <WhatsAppAurora />
      <SectionMotion effect="whatsapp" className={styles.scroller}>
        <div className={cn(landing.container, styles.layout)}>
          <div className={styles.copy}>
            <RevealLines
              id="whatsapp-title"
              className={cn(landing.h2, styles.title)}
              lines={['Seu plano não deveria', 'ficar parado enquanto', 'sua vida muda.']}
            />
            <p className={cn(landing.body, landing.secondaryText)} data-reveal="">
              A MOVIVO acompanha seus registros, sua rotina e sua evolução para manter o plano
              alinhado ao que você realmente consegue executar.
            </p>
            <ul className={styles.benefits}>
              {BENEFITS.map(({ text, Icon }) => (
                <li key={text} data-reveal="">
                  <Icon className={styles.benefitIcon} strokeWidth={1.8} aria-hidden="true" />
                  {text}
                </li>
              ))}
            </ul>
          </div>

          <div className={styles.phoneColumn}>
            <figure className={styles.figure}>
              <figcaption className="sr-only">
                Exemplo ilustrativo de conversa entre a pessoa e a MOVIVO no WhatsApp.
              </figcaption>
              <div className={styles.phone} data-phone="">
                <span className={styles.camera} aria-hidden="true" />
                <div className={styles.screen}>
                  <div className={styles.chatHeader} aria-hidden="true">
                    <span className={styles.avatar}>
                      <MovivoSymbol className={styles.avatarMark} />
                    </span>
                    <span className={styles.contact}>
                      <strong>MOVIVO</strong>
                      <span>online</span>
                    </span>
                  </div>
                  <ol className={styles.thread} aria-label="Conversa ilustrativa com a MOVIVO">
                    <li className={styles.day} aria-hidden="true">
                      Hoje
                    </li>
                    {CONVERSATION.map((item, index) => (
                      <li
                        key={index}
                        className={cn(styles.message, item.kind === 'out' ? styles.out : styles.in)}
                        data-message={item.kind}
                      >
                        <span className="sr-only">
                          {item.kind === 'out' ? 'Você: ' : 'MOVIVO: '}
                        </span>
                        {item.text.map((paragraph) => (
                          <p key={paragraph}>{paragraph}</p>
                        ))}
                        <time className={styles.time}>{item.time}</time>
                      </li>
                    ))}
                    <li className={styles.typing} data-typing="" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </li>
                  </ol>
                  <div className={styles.composer} aria-hidden="true">
                    <span>Mensagem</span>
                    <span className={styles.send}>
                      <svg viewBox="0 0 24 24">
                        <path d="M4 12h13M12 6l6 6-6 6" />
                      </svg>
                    </span>
                  </div>
                </div>
              </div>
              <figcaption className={styles.caption}>Conversa ilustrativa</figcaption>
            </figure>
          </div>
        </div>
      </SectionMotion>
    </section>
  );
}

import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowDownRight,
  Check,
  ChevronDown,
  Menu,
  RefreshCw,
  ShieldCheck,
  UserRoundCheck,
  type LucideIcon,
} from 'lucide-react';

import { StartCta } from '@/components/start-cta';
import { PricingCards } from '@/components/pricing-cards';

import styles from './landing.module.css';

export const metadata: Metadata = {
  title: { absolute: 'Movivo' },
  description:
    'Treino individualizado com metodologia profissional, acompanhamento e conversa pelo WhatsApp. Conheça a MOVIVO por 7 dias, sem cartão.',
  alternates: { canonical: '/' },
};

const NAV_LINKS = [
  ['Como funciona', '#como-funciona'],
  ['Pra quem é', '#pra-quem-e'],
  ['Benefícios', '#beneficios'],
  ['Profissional', '#profissional'],
  ['Planos', '#planos'],
  ['FAQ', '#faq'],
] as const;

const PROVAS: Array<{ icon: LucideIcon; text: string }> = [
  { icon: UserRoundCheck, text: 'Individualizado para você' },
  { icon: RefreshCw, text: 'De acordo com sua rotina e disponibilidade' },
  { icon: ShieldCheck, text: 'Acompanhamento humano' },
];

const MARQUEE = [
  {
    icon: 'https://img.icons8.com/ios/50/25e27e/microscope.png',
    text: 'Baseado em ciência',
  },
  {
    icon: 'https://img.icons8.com/ios/50/25e27e/connection-sync.png',
    text: 'Adaptação contínua',
  },
  {
    icon: 'https://img.icons8.com/ios/50/25e27e/personal-trainer.png',
    text: 'Profissional CREF',
  },
  {
    icon: 'https://img.icons8.com/ios/50/25e27e/data-protection.png',
    text: 'Seus dados protegidos',
  },
];

const PASSOS = [
  {
    icon: 'https://img.icons8.com/ios/50/06302a/clipboard.png',
    title: 'Conte sua realidade',
    description:
      'Objetivo, experiência, rotina, disponibilidade e equipamentos formam o ponto de partida.',
  },
  {
    icon: 'https://img.icons8.com/ios/50/06302a/inbox.png',
    title: 'Receba seu protocolo',
    description:
      'O método transforma seu contexto em uma orientação individualizada, com supervisão profissional.',
  },
  {
    icon: 'https://img.icons8.com/ios/50/06302a/dumbbell.png',
    title: 'Treine e conte como foi',
    description:
      'As orientações chegam pelo WhatsApp. Você executa e compartilha seus feedbacks sem aprender outro app.',
  },
  {
    icon: 'https://img.icons8.com/ios/50/06302a/combo-chart.png',
    title: 'Evolua com contexto',
    description:
      'Check-ins ajudam a orientar os ajustes previstos pelo método ao longo da sua jornada.',
  },
];

const PUBLICOS = [
  {
    title: 'Vai começar',
    text: 'Para quem quer sair da tentativa e erro com um ponto de partida claro e adequado à própria realidade.',
  },
  {
    title: 'Quer voltar',
    text: 'Para quem teve a rotina interrompida e precisa recomeçar a partir do tempo e da energia que tem hoje.',
  },
  {
    title: 'Já treina',
    text: 'Para quem valoriza organização de volume, frequência, execução e progressão em vez de novidade aleatória.',
  },
  {
    title: 'Concilia outra modalidade',
    text: 'Para atletas e entusiastas que buscam uma musculação compatível com a rotina esportiva e a recuperação.',
  },
  {
    title: 'Tem pouco tempo',
    text: 'Para quem precisa fazer o treino caber na agenda, no local disponível e no tempo real do dia.',
  },
  {
    title: 'Cansou do genérico',
    text: 'Para quem quer contexto e método no lugar de fichas prontas, dicas soltas e prompts improvisados.',
  },
] as const;

const BENEFICIOS = [
  [
    'Mais contexto,',
    'menos achismo',
    'Seu treino parte da sua rotina, dos recursos disponíveis e de critérios profissionais.',
  ],
  [
    'Mais proximidade,',
    'menos fricção',
    'A conversa acontece no WhatsApp, um canal que já faz parte do seu dia.',
  ],
  [
    'Mais método,',
    'menos improviso',
    'A tecnologia aplica uma estrutura definida e supervisionada por profissional registrado.',
  ],
  [
    'Mais adaptação,',
    'menos rigidez',
    'Feedbacks e mudanças de rotina entram no acompanhamento e podem orientar ajustes previstos.',
  ],
] as const;

const FAQ = [
  {
    question: 'O treino é realmente individualizado?',
    answer:
      'A construção considera objetivo, experiência, rotina, disponibilidade, limitações informadas e recursos disponíveis, sempre dentro da metodologia MOVIVO.',
  },
  {
    question: 'A MOVIVO é apenas uma inteligência artificial?',
    answer:
      'Não. A tecnologia é uma ferramenta para aplicar e comunicar uma metodologia definida e supervisionada por profissional de Educação Física registrado no CREF. Ela não decide nem prescreve sozinha.',
  },
  {
    question: 'Preciso instalar outro aplicativo?',
    answer:
      'Não. Depois do cadastro inicial, o WhatsApp é o principal canal para receber orientações, tirar dúvidas e enviar feedbacks.',
  },
  {
    question: 'Preciso treinar em academia?',
    answer:
      'Não necessariamente. O planejamento considera o ambiente e os equipamentos que você informou, quando forem compatíveis com sua modalidade e seu contexto.',
  },
  {
    question: 'Sou iniciante. Posso começar?',
    answer:
      'Sim. O processo começa entendendo seu nível atual. As respostas da anamnese e do PAR-Q também indicam quando o fluxo precisa de avaliação profissional antes de seguir.',
  },
  {
    question: 'Como funcionam os 7 dias grátis?',
    answer:
      'Você começa sem cadastrar cartão. Ao final do período, não há cobrança automática: para continuar, é preciso escolher um período e confirmar a contratação.',
  },
  {
    question: 'Meus dados ficam protegidos?',
    answer:
      'A MOVIVO trata privacidade e segurança como parte do produto. Dados de saúde exigem consentimento específico e controles compatíveis com a LGPD.',
  },
] as const;

function Logo() {
  return (
    <Link href="#topo" className={styles.logoLink} aria-label="MOVIVO — início">
      <Image
        src="/brand/movivo-logo-horizontal.svg"
        alt="MOVIVO"
        width={154}
        height={40}
        priority
      />
    </Link>
  );
}

type HeroWaveLayer = {
  id: string;
  trackClassName: string;
  fillFrom: string;
  fillMid: string;
  fillPath: string;
  strokePath: string;
  strokeColor: string;
};

const HERO_WAVE_LAYERS: HeroWaveLayer[] = [
  {
    id: 'back',
    trackClassName: `${styles.heroWaveTrack} ${styles.heroWaveTrackBack}`,
    fillFrom: 'rgba(37, 226, 126, 0.18)',
    fillMid: 'rgba(37, 226, 126, 0.05)',
    fillPath:
      'M0,190 C100,190 200,90 300,90 C400,90 500,190 600,190 C700,190 800,290 900,290 C1000,290 1100,190 1200,190 L1200,400 L0,400 Z',
    strokePath:
      'M0,190 C100,190 200,90 300,90 C400,90 500,190 600,190 C700,190 800,290 900,290 C1000,290 1100,190 1200,190',
    strokeColor: 'rgba(37, 226, 126, 0.32)',
  },
  {
    id: 'front',
    trackClassName: `${styles.heroWaveTrack} ${styles.heroWaveTrackFront}`,
    fillFrom: 'rgba(255, 255, 255, 0.16)',
    fillMid: 'rgba(255, 255, 255, 0.04)',
    fillPath:
      'M0,260 C120,260 220,150 340,150 C460,150 560,260 680,260 C800,260 900,340 1020,340 C1120,340 1180,260 1200,260 L1200,400 L0,400 Z',
    strokePath:
      'M0,260 C120,260 220,150 340,150 C460,150 560,260 680,260 C800,260 900,340 1020,340 C1120,340 1180,260 1200,260',
    strokeColor: 'rgba(255, 255, 255, 0.4)',
  },
];

function HeroWaveTile({ layer, tileIndex }: { layer: HeroWaveLayer; tileIndex: number }) {
  const gradientId = `heroWaveFill-${layer.id}-${tileIndex}`;
  return (
    <svg className={styles.heroWave} viewBox="0 0 1200 400" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={layer.fillFrom} />
          <stop offset="55%" stopColor={layer.fillMid} />
          <stop offset="100%" stopColor="rgba(6, 48, 42, 0)" />
        </linearGradient>
      </defs>
      <path d={layer.fillPath} fill={`url(#${gradientId})`} />
      <path
        d={layer.strokePath}
        fill="none"
        stroke={layer.strokeColor}
        strokeWidth={2}
        className={styles.heroWaveRim}
      />
    </svg>
  );
}

function HeroLiquidGlass() {
  return (
    <div className={styles.heroGlass} aria-hidden="true">
      <div className={styles.heroDiagonal}>
        {HERO_WAVE_LAYERS.map((layer) => (
          <div key={layer.id} className={layer.trackClassName}>
            <HeroWaveTile layer={layer} tileIndex={0} />
            <HeroWaveTile layer={layer} tileIndex={1} />
          </div>
        ))}
      </div>
    </div>
  );
}

function MarqueeSet({ hidden = false }: { hidden?: boolean }) {
  return (
    <div className={styles.marqueeSet} aria-hidden={hidden || undefined}>
      {MARQUEE.map(({ icon, text }) => (
        <span key={text} className={styles.marqueeItem}>
          <Image src={icon} alt="" width={28} height={28} aria-hidden="true" />
          {text}
        </span>
      ))}
    </div>
  );
}

export default function HomePage() {
  return (
    <div id="topo" className={`${styles.landing} landing-light`}>
      <a href="#conteudo" className={styles.skipLink}>
        Pular para o conteúdo
      </a>

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.logoDesktop}>
            <Logo />
          </div>
          <div className={styles.logoMobile}>
            <Logo />
          </div>

          <nav className={styles.desktopNav} aria-label="Navegação principal">
            {NAV_LINKS.map(([label, href]) => (
              <a key={href} href={href}>
                {label}
              </a>
            ))}
          </nav>

          <div className={styles.headerActions}>
            <div className={styles.desktopHeaderCta}>
              <StartCta
                location="navbar"
                showMicrocopy={false}
                buttonClassName={styles.headerCta}
              />
            </div>
            <details className={styles.mobileMenu}>
              <summary aria-label="Abrir menu">
                <Menu aria-hidden="true" />
              </summary>
              <nav aria-label="Navegação mobile">
                {NAV_LINKS.map(([label, href]) => (
                  <a key={href} href={href}>
                    {label}
                    <ArrowDownRight aria-hidden="true" />
                  </a>
                ))}
                <StartCta
                  location="navbar_mobile"
                  showMicrocopy={false}
                  className={styles.mobileMenuCta}
                  buttonClassName={styles.headerCta}
                />
              </nav>
            </details>
          </div>
        </div>
      </header>

      <main id="conteudo">
        <section className={styles.hero} aria-labelledby="hero-title">
          <HeroLiquidGlass />
          <div className={styles.heroInner}>
            <div className={styles.heroCopy}>
              <h1 id="hero-title">
                Seu treino. <em>Seu coach.</em> Sua rotina.
              </h1>
              <p className={styles.heroLead}>
                Treino e acompanhamento personalizados, com estratégia, metodologia, respaldo humano
                e embasamento científico. Tudo pelo WhatsApp, integrado à rotina que você já vive!
              </p>
              <ul className={styles.heroProofs} aria-label="Diferenciais da MOVIVO">
                {PROVAS.map(({ icon: Icon, text }) => (
                  <li key={text}>
                    <Icon aria-hidden="true" />
                    <span>{text}</span>
                  </li>
                ))}
              </ul>
              <StartCta
                label="Receber acompanhamento diretamente no WhatsApp"
                location="hero"
                className={styles.heroCta}
                buttonClassName={styles.primaryCta}
                microcopy="Rápido, prático e 100% no WhatsApp"
              />
            </div>
            <div className={styles.heroVisual}>
              <Image
                src="/hero/hero-atleta.png"
                alt=""
                aria-hidden="true"
                fill
                sizes="(min-width: 64rem) 42vw, 1px"
                className={styles.heroVisualImage}
              />
            </div>
          </div>
        </section>

        <section className={styles.manifestoStrip} aria-labelledby="manifesto-title">
          <div className={styles.sectionInner}>
            <p className={styles.sectionIndex}>01 — A ESSÊNCIA</p>
            <h2 id="manifesto-title">Ciência que treina com você.</h2>
          </div>
          <div className={styles.marquee} role="group" aria-label="Compromissos da MOVIVO">
            <div className={styles.marqueeTrack}>
              <MarqueeSet />
              <MarqueeSet hidden />
              <MarqueeSet hidden />
              <MarqueeSet hidden />
              <MarqueeSet hidden />
            </div>
          </div>
        </section>

        <section id="como-funciona" className={`${styles.how} ${styles.sectionAnchor}`}>
          <div className={styles.sectionInner}>
            <div className={styles.sectionIntro}>
              <h2 className={styles.howTitle}>
                Você conta sua realidade. A{' '}
                <span className={styles.howTitleLogo} aria-label="MOVIVO">
                  <Image
                    className={styles.howTitleWordmark}
                    src="/brand/movivo-logo-horizontal.svg"
                    alt=""
                    width={1000}
                    height={260}
                    aria-hidden="true"
                  />
                </span>{' '}
                transforma isso em método.
              </h2>
              <p>
                Do primeiro contato ao acompanhamento, todo o processo foi pensado para se adaptar a
                você, com eficiência, transparência e sem promessas fáceis.
              </p>
            </div>
            <ol className={styles.steps}>
              {PASSOS.map(({ icon, title, description }, index) => (
                <li key={title}>
                  <div className={styles.stepMarker}>
                    <Image src={icon} alt="" width={28} height={28} aria-hidden="true" />
                    <span>{String(index + 1).padStart(2, '0')}</span>
                  </div>
                  <div>
                    <h3>{title}</h3>
                    <p>{description}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className={styles.summaryBlock}>
              <p>
                A MOVIVO existe para tornar a orientação de treino de qualidade mais acessível,
                unindo método, ciência, tecnologia e acompanhamento humano. Pelo WhatsApp, cada
                pessoa recebe um treino individualizado, adaptado à sua rotina, objetivos, recursos
                e evolução, com apoio de inteligência artificial e supervisão profissional.
                Acreditamos que treinar bem não precisa ser caro, complicado nem baseado em
                achismos.
              </p>
            </div>
          </div>
        </section>

        <section id="pra-quem-e" className={`${styles.audience} ${styles.sectionAnchor}`}>
          <div className={styles.sectionInner}>
            <div className={styles.audienceHeader}>
              <div>
                <h2>O ponto de partida é a vida que você tem agora.</h2>
              </div>
              <p>
                O treino se adapta ao seu momento. Você não precisa moldar toda a sua vida a uma
                ficha feita para outra pessoa.
              </p>
            </div>
            <ol className={styles.audienceList}>
              {PUBLICOS.map(({ title, text }, index) => (
                <li key={title}>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                  <ArrowDownRight aria-hidden="true" />
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="beneficios" className={`${styles.benefits} ${styles.sectionAnchor}`}>
          <div className={styles.sectionInner}>
            <div className={styles.benefitsHeader}>
              <h2>Treinar com orientação muda a relação com o processo.</h2>
            </div>
            <div className={styles.benefitComposition}>
              <div className={styles.benefitTarget} aria-hidden="true">
                <div className={styles.benefitPulse}>
                  <Image src="/brand/movivo-symbol.svg" alt="" width={290} height={222} />
                </div>
                <span>contexto → método → constância</span>
              </div>
              <ol className={styles.benefitList}>
                {BENEFICIOS.map(([line, emphasis, description], index) => (
                  <li key={emphasis}>
                    <span>{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <h3>
                        {line} <em>{emphasis}</em>
                      </h3>
                      <p>{description}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <section id="profissional" className={`${styles.professional} ${styles.sectionAnchor}`}>
          <div className={styles.sectionInner}>
            <div className={styles.professionalStatement}>
              <h2>
                A tecnologia amplia o acesso. <em>A responsabilidade continua humana.</em>
              </h2>
            </div>
            <div className={styles.professionalGrid}>
              <div className={styles.professionalMark}>
                <Image
                  src="/professional/leonardo-rodrigues.png"
                  alt="Leonardo Rodrigues"
                  fill
                  sizes="(min-width: 64rem) 36vw, 100vw"
                  className={styles.professionalPhoto}
                />
              </div>
              <div className={styles.professionalCopy}>
                <p>
                  A metodologia MOVIVO é desenvolvida e supervisionada por Leonardo Rodrigues,
                  profissional de Educação Física registrado no CREF, com mais de 15 anos de
                  experiência como treinador e atleta.
                </p>
                <p>
                  É ele quem define os critérios, as progressões, as alternativas, os limites de
                  atuação e as situações que exigem avaliação e acompanhamento humano, garantindo
                  que a metodologia seja aplicada com responsabilidade, segurança e propósito.
                </p>
                <p>
                  A IA atua como ferramenta de conversa e aplicação do método. Ela não recebe
                  autoridade para decidir ou prescrever seu treino sozinha.
                </p>
                <ul className={styles.professionalChecks}>
                  <li>
                    <Check aria-hidden="true" /> Seu contexto vem primeiro
                  </li>
                  <li>
                    <Check aria-hidden="true" /> Critérios profissionais limitam as alternativas
                  </li>
                  <li>
                    <Check aria-hidden="true" /> Exceções seguem para avaliação humana
                  </li>
                </ul>
                <ul
                  className={styles.professionalStats}
                  aria-label="Experiência de Leonardo Rodrigues"
                >
                  <li>
                    <strong>15+ anos</strong>
                    <span>como treinador</span>
                  </li>
                  <li>
                    <strong>533+ atletas</strong>
                    <span>treinados</span>
                  </li>
                  <li>
                    <strong>∞ vontade</strong>
                    <span>de ver você alcançar seus resultados</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        <section id="planos" className={`${styles.pricing} ${styles.sectionAnchor}`}>
          <div className={styles.sectionInner}>
            <div className={styles.pricingIntro}>
              <div>
                <h2>O produto é o mesmo. Você escolhe por quanto tempo quer continuar.</h2>
              </div>
            </div>
            <PricingCards />
          </div>
        </section>

        <section id="faq" className={`${styles.faq} ${styles.sectionAnchor}`}>
          <div className={styles.sectionInner}>
            <div className={styles.faqGrid}>
              <div className={styles.faqIntro}>
                <h2>
                  Antes de começar, <span>pode perguntar.</span>
                </h2>
                <p>Transparência também faz parte de treinar com responsabilidade.</p>
              </div>
              <div className={styles.faqList}>
                {FAQ.map(({ question, answer }) => (
                  <details key={question} data-analytics-event="faq_open">
                    <summary>
                      <span>{question}</span>
                      <ChevronDown aria-hidden="true" />
                    </summary>
                    <p>{answer}</p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className={styles.closing} aria-labelledby="closing-title">
          <div className={styles.sectionInner}>
            <div className={styles.closingCopy}>
              <p className={styles.sectionIndex}>COMECE PELO QUE É POSSÍVEL HOJE</p>
              <h2 id="closing-title">Treino sério não precisa ser caro nem complicado.</h2>
            </div>
            <div className={styles.closingAction}>
              <p>
                Conte como é sua rotina e conheça uma orientação construída dentro de um método
                profissional, direto no WhatsApp.
              </p>
              <StartCta
                label="Receber acompanhamento diretamente no WhatsApp"
                location="closing"
                className={styles.closingCta}
                buttonClassName={styles.primaryCta}
                microcopy="7 dias grátis · sem cartão · para maiores de 18 anos"
              />
            </div>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.sectionInner}>
          <div className={styles.footerShell}>
            <div className={styles.footerCard}>
              <div className={styles.footerGrid}>
                <div className={styles.footerBrand}>
                  <Logo />
                  <p className={styles.footerSlogan}>Ciência que treina com você.</p>
                  <p>
                    Orientação de treino individualizada pelo WhatsApp, com tecnologia aplicada
                    dentro de uma metodologia supervisionada por profissional de Educação Física
                    registrado no CREF.
                  </p>
                </div>

                <nav className={styles.footerColumn} aria-label="Produto">
                  <p>Produto</p>
                  <a href="#como-funciona">Como funciona</a>
                  <a href="#pra-quem-e">Pra quem é</a>
                  <a href="#beneficios">Benefícios</a>
                </nav>

                <nav className={styles.footerColumn} aria-label="Confiança">
                  <p>Confiança</p>
                  <a href="#profissional">Profissional</a>
                  <a href="#planos">Planos</a>
                  <a href="#faq">Dúvidas</a>
                </nav>

                <nav className={styles.footerColumn} aria-label="Acesso">
                  <p>Acesso</p>
                  <Link href="/anamnese">Começar agora</Link>
                  <a href="#topo">Voltar ao topo</a>
                </nav>
              </div>
            </div>

            <div className={styles.footerLegal}>
              <span>© {new Date().getFullYear()} MOVIVO. Todos os direitos reservados.</span>
              <div>
                <span>Feito para movimento real.</span>
              </div>
            </div>
          </div>

          <div className={styles.footerWordmark} aria-hidden="true">
            <svg className={styles.footerFilter} focusable="false">
              <defs>
                <filter id="movivo-footer-glass" x="-30%" y="-40%" width="160%" height="180%">
                  <feDropShadow
                    dx="0"
                    dy="5"
                    stdDeviation="7"
                    floodColor="#06302a"
                    floodOpacity="0.2"
                  />
                  <feGaussianBlur in="SourceAlpha" stdDeviation="4" result="blur" />
                  <feSpecularLighting
                    in="blur"
                    surfaceScale="4"
                    specularConstant="0.35"
                    specularExponent="18"
                    lightingColor="#ffffff"
                    result="light"
                  >
                    <feDistantLight azimuth="225" elevation="45" />
                  </feSpecularLighting>
                  <feComposite in="light" in2="SourceAlpha" operator="in" result="lit" />
                  <feMerge>
                    <feMergeNode in="SourceGraphic" />
                    <feMergeNode in="lit" />
                  </feMerge>
                </filter>
              </defs>
            </svg>
            <span>movivo</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

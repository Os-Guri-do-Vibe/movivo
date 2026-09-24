import { cn } from '@/lib/utils';
import { SOCIAL } from '@/lib/landing/site';
import { publicEnv } from '@/lib/env';

import { landingFontVariables } from './fonts';
import styles from './landing.module.css';
import { Footer } from './layout/footer';
import { MobileStickyCta } from './layout/mobile-sticky-cta';
import { Navbar } from './layout/navbar';
import { Preloader } from './layout/preloader';
import { LandingRuntime } from './motion/landing-runtime';
import { AdaptiveTraining } from './sections/adaptive-training';
import { DayWithMovivo } from './sections/day-with-movivo';
import { FinalCta } from './sections/final-cta';
import { Hero } from './sections/hero';
import { HowItWorks } from './sections/how-it-works';
import { IntelligenceHuman } from './sections/intelligence-human';
import { Manifesto } from './sections/manifesto';
import { MovivoClub } from './sections/movivo-club';
import { MuscleMapSection } from './sections/muscle-map';
import { Pricing } from './sections/pricing';
import { PulseSystem } from './sections/pulse-system';
import { WhatsAppExperience } from './sections/whatsapp-experience';

/** Dados estruturados só com fatos verificáveis: nome, site, logo e perfil oficial. */
function OrganizationJsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'MOVIVO',
    url: publicEnv.siteUrl,
    logo: new URL('/brand/movivo-logo-horizontal.svg', publicEnv.siteUrl).toString(),
    sameAs: [SOCIAL.instagram.url],
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}

/**
 * Landing pública da MOVIVO. Ordem narrativa: MOVE → BELIEVE → UNDERSTAND → EXPERIENCE
 * → LEARN → TRUST → PERSONALIZE → ADAPT → LIVE → BELONG → BEGIN → MOVE IT.
 */
export function Landing() {
  return (
    <div className={cn(styles.root, landingFontVariables)} data-landing-root="">
      <Preloader />
      <a href="#conteudo" className={styles.skipLink}>
        Pular para o conteúdo
      </a>
      <Navbar />
      <main id="conteudo" tabIndex={-1}>
        <Hero />
        <Manifesto />
        <PulseSystem />
        <WhatsAppExperience />
        <HowItWorks />
        <IntelligenceHuman />
        <MuscleMapSection />
        <AdaptiveTraining />
        <DayWithMovivo />
        <MovivoClub />
        <Pricing />
        <FinalCta />
      </main>
      <Footer />
      <MobileStickyCta />
      <LandingRuntime />
      <OrganizationJsonLd />
    </div>
  );
}

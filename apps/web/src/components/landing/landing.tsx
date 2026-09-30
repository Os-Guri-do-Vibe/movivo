import { cn } from '@/lib/utils';
import { buildLandingStructuredData } from '@/lib/landing/structured-data';
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
import { Faq } from './sections/faq';
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

/** Dados estruturados só com fatos da página: organização, site, serviço, planos e FAQ. */
function StructuredData() {
  const data = buildLandingStructuredData(publicEnv.siteUrl);
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}

/**
 * Landing pública da MOVIVO. Ordem narrativa: MOVE → BELIEVE → UNDERSTAND → EXPERIENCE
 * → LEARN → TRUST → PERSONALIZE → ADAPT → LIVE → BELONG → BEGIN → ASK → MOVE IT.
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
        <Faq />
        <FinalCta />
      </main>
      <Footer />
      <MobileStickyCta />
      <LandingRuntime />
      <StructuredData />
    </div>
  );
}

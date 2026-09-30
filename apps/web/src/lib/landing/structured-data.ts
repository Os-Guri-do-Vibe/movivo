/**
 * Dados estruturados (schema.org/JSON-LD) da landing, num único `@graph`.
 *
 * Só fatos que a página já mostra: organização, site, a própria página, o serviço com os
 * planos (derivados do mesmo catálogo da vitrine) e o FAQ (a mesma lista da seção visível).
 * Sem avaliações, sem notas, sem credenciais individuais.
 */
import { SOCIAL } from './site';
import { buildFaq, type FaqItem } from './faq';
import { LANDING_PLANS, billingCadence, type LandingPlan } from './pricing';
import {
  HOME_DESCRIPTION,
  HOME_TITLE,
  ORGANIZATION_DESCRIPTION,
  SERVICE_NAME,
  SITE_NAME,
} from './seo';

export function buildLandingStructuredData(
  siteUrl: string,
  plans: readonly LandingPlan[] = LANDING_PLANS,
  faq: readonly FaqItem[] = buildFaq(plans),
) {
  const origin = new URL(siteUrl).origin;
  const organizationId = `${origin}/#organization`;
  const websiteId = `${origin}/#website`;
  const serviceId = `${origin}/#service`;

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': organizationId,
        name: SITE_NAME,
        url: `${origin}/`,
        logo: `${origin}/brand/movivo-logo-horizontal.svg`,
        description: ORGANIZATION_DESCRIPTION,
        slogan: 'Ciência que treina com você',
        sameAs: [SOCIAL.instagram.url],
      },
      {
        '@type': 'WebSite',
        '@id': websiteId,
        name: SITE_NAME,
        url: `${origin}/`,
        inLanguage: 'pt-BR',
        publisher: { '@id': organizationId },
      },
      {
        '@type': 'WebPage',
        '@id': `${origin}/#webpage`,
        url: `${origin}/`,
        name: HOME_TITLE,
        description: HOME_DESCRIPTION,
        inLanguage: 'pt-BR',
        isPartOf: { '@id': websiteId },
        about: { '@id': serviceId },
      },
      {
        '@type': 'Service',
        '@id': serviceId,
        name: SERVICE_NAME,
        serviceType: 'Orientação de treino',
        description: ORGANIZATION_DESCRIPTION,
        provider: { '@id': organizationId },
        areaServed: { '@type': 'Country', name: 'Brasil' },
        audience: { '@type': 'PeopleAudience', suggestedMinAge: 18 },
        offers: plans.map((plan) => ({
          '@type': 'Offer',
          name: `Plano ${plan.label.toLowerCase()}`,
          description: `Cobrança ${billingCadence(plan.months)}.`,
          price: (plan.totalCents / 100).toFixed(2),
          priceCurrency: 'BRL',
          url: `${origin}/#planos`,
        })),
      },
      {
        '@type': 'FAQPage',
        '@id': `${origin}/#faq`,
        isPartOf: { '@id': `${origin}/#webpage` },
        inLanguage: 'pt-BR',
        mainEntity: faq.map((item) => ({
          '@type': 'Question',
          name: item.question,
          acceptedAnswer: { '@type': 'Answer', text: item.answer },
        })),
      },
    ],
  };
}

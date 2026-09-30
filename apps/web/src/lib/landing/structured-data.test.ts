/** Dados estruturados e FAQ: sem inventar fatos, coerentes com a vitrine e com a página. */
import { describe, expect, it } from 'vitest';

import { buildFaq } from './faq';
import { LANDING_PLANS, formatBRL } from './pricing';
import { buildLandingStructuredData } from './structured-data';

const SITE = 'https://movivo.com.br';

type Node = Record<string, unknown> & { '@type': string };

function graph(siteUrl = SITE): Node[] {
  return buildLandingStructuredData(siteUrl)['@graph'] as Node[];
}

describe('FAQ da landing', () => {
  const faq = buildFaq();

  it('tem ids únicos e respostas não vazias', () => {
    expect(new Set(faq.map((item) => item.id)).size).toBe(faq.length);
    for (const item of faq) {
      expect(item.question.endsWith('?')).toBe(true);
      expect(item.answer.length).toBeGreaterThan(20);
    }
  });

  it('respeita os guardrails de linguagem', () => {
    const text = faq.map((item) => `${item.question} ${item.answer}`).join(' ');
    expect(text).not.toMatch(/diagn[óo]stic|tratament|\bcura\b|garantid/i);
  });

  it('deriva o preço do catálogo de planos, sem valor digitado à mão', () => {
    const price = faq.find((item) => item.id === 'preco');
    for (const plan of LANDING_PLANS) {
      expect(price?.answer).toContain(formatBRL(plan.totalCents).replace(/\s/g, ' '));
    }
  });
});

describe('dados estruturados da landing', () => {
  it('usa o domínio informado em todos os ids e urls, sem barra dupla', () => {
    const json = JSON.stringify(graph());
    expect(json).not.toMatch(/localhost|127\.0\.0\.1/);
    expect(json).not.toMatch(/movivo\.com\.br\/\//);
    expect(JSON.stringify(graph('https://movivo.com.br/'))).toBe(json);
  });

  it('publica organização, site, página, serviço e FAQ', () => {
    expect(graph().map((node) => node['@type'])).toEqual([
      'Organization',
      'WebSite',
      'WebPage',
      'Service',
      'FAQPage',
    ]);
  });

  it('lista um Offer por plano em BRL com preço decimal', () => {
    const service = graph().find((node) => node['@type'] === 'Service') as Node & {
      offers: { price: string; priceCurrency: string }[];
    };
    expect(service.offers).toHaveLength(LANDING_PLANS.length);
    for (const offer of service.offers) {
      expect(offer.priceCurrency).toBe('BRL');
      expect(offer.price).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it('o FAQPage espelha exatamente a lista visível', () => {
    const page = graph().find((node) => node['@type'] === 'FAQPage') as Node & {
      mainEntity: { name: string; acceptedAnswer: { text: string } }[];
    };
    expect(page.mainEntity.map((q) => [q.name, q.acceptedAnswer.text])).toEqual(
      buildFaq().map((item) => [item.question, item.answer]),
    );
  });
});

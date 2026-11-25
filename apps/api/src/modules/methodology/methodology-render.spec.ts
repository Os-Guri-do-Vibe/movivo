import { exampleParameters, METHODOLOGY_DOMAIN_SPECS } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import { devMethodologyParameters } from '../../core/database/seed-methodology';
import { zonePacePctOf5k } from '../planning/calc/params';
import { renderMethodology } from './methodology-render';

describe('renderização da metodologia para os agentes', () => {
  it.each(METHODOLOGY_DOMAIN_SPECS.map((spec) => [spec.domain, spec] as const))(
    '%s: documento completo sai sem "undefined"',
    (_domain, spec) => {
      const text = renderMethodology(spec, 3, exampleParameters(spec), {});
      expect(text).toContain(`## ${spec.title} (versão 3)`);
      expect(text).not.toMatch(/undefined|null|NaN/);
    },
  );

  // Um campo novo na especificação não existe nos documentos já publicados: a geração de planos
  // não pode quebrar (nem mandar "undefined" ao agente) até o profissional publicar de novo.
  it.each(METHODOLOGY_DOMAIN_SPECS.map((spec) => [spec.domain, spec] as const))(
    '%s: documento publicado sem um campo da especificação continua renderizando',
    (_domain, spec) => {
      for (const section of spec.sections) {
        for (const [key, field] of Object.entries(section.fields)) {
          const published = structuredClone(exampleParameters(spec));
          delete published[section.key]?.[key];
          const text = renderMethodology(spec, 1, published, {});
          expect(text, `${section.key}.${key}`).not.toMatch(/undefined|null|NaN/);
          expect(text, `${section.key}.${key}`).not.toContain(`- ${field.label}:`);
        }
        const withoutSection = structuredClone(exampleParameters(spec));
        delete withoutSection[section.key];
        expect(() => renderMethodology(spec, 1, withoutSection, {})).not.toThrow();
      }
    },
  );

  it('tabela publicada sem uma linha mostra só as linhas que existem', () => {
    const spec = METHODOLOGY_DOMAIN_SPECS.find((s) => s.domain === 'RUNNING');
    if (!spec) throw new Error('fixture');
    const published = structuredClone(exampleParameters(spec));
    const zones = published.zones?.zoneBoundsPctHrMax as Record<string, unknown>;
    delete zones.Z3;
    const text = renderMethodology(spec, 1, published, {});
    expect(text).toMatch(/Limites das zonas[^\n]*\n {2}- Z1:/);
    expect(text).not.toMatch(/ {2}- Z3: .*\n {2}- Z4: [^\n]*\n {2}- Z5: [^\n]*\n- Ritmo/);
    expect(text).not.toMatch(/undefined/);
  });

  it('a metodologia de corrida publicada antes do ritmo por zona segue valendo, com o padrão no cálculo', () => {
    const spec = METHODOLOGY_DOMAIN_SPECS.find((s) => s.domain === 'RUNNING');
    if (!spec) throw new Error('fixture');
    const published = structuredClone(devMethodologyParameters('RUNNING'));
    delete published.zones?.zonePacePctOf5k;
    const text = renderMethodology(spec, 1, published, {});
    expect(text).toContain('Limites das zonas');
    expect(text).not.toContain('Ritmo de referência por zona');
    expect(zonePacePctOf5k(published).Z2).toEqual({ min: 120, max: 135 });
    // Um rascunho novo já nasce com a tabela preenchida, zona a zona.
    expect(exampleParameters(spec).zones?.zonePacePctOf5k).toMatchObject({
      Z1: { pct: { min: 135, max: 150 } },
      Z5: { pct: { min: 95, max: 103 } },
    });
  });
});

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/landing/fonts', () => ({ landingFontVariables: 'test-fonts' }));
vi.mock('@/components/landing/ui/movivo-logo', () => ({
  MovivoLogo: () => <span>MOVIVO</span>,
}));

import { LegalPage } from './legal-page';

describe('página legal', () => {
  it('preserva tabela, lista e links públicos do Markdown', () => {
    render(
      <LegalPage
        title="Política de Privacidade"
        document={{
          version: 'privacy-2026-09-v1',
          effectiveOn: '2026-10-01',
          markdown:
            '## Compartilhamento\n\n| Categoria | Finalidade |\n| --- | --- |\n| IA | Treino |\n\n- [LGPD](https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm)',
        }}
      />,
    );
    const article = screen.getByRole('article', { name: 'Política de Privacidade' });
    expect(within(article).getByRole('heading', { name: 'Compartilhamento' })).toBeVisible();
    expect(within(article).getByRole('table')).toHaveTextContent('IA');
    expect(within(article).getByRole('listitem')).toHaveTextContent('LGPD');
    expect(within(article).getByRole('link', { name: /LGPD/ })).toHaveAttribute(
      'href',
      'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm',
    );
  });
});

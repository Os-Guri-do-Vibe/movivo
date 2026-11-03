import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MarkdownView } from './markdown-view';

const FICHA = `# Especialista em Musculação

## Quem sou

Sou o **preparador de força** da MOVIVO.

## Como trabalho

- Técnica antes de carga.
- Uso o campo \`weeklyFrequency\`.

### Exemplo

**Aluno não treinou.**
Evito: "Falta disciplina."
Prefiro: "Foi tempo ou disposição?"
`;

describe('MarkdownView', () => {
  it('transforma o markdown em seções, listas e destaques legíveis', () => {
    render(<MarkdownView content={FICHA} />);

    expect(screen.getByRole('heading', { level: 4, name: 'Quem sou' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 4, name: 'Como trabalho' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 5, name: 'Exemplo' })).toBeVisible();
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(screen.getByText('preparador de força').tagName).toBe('STRONG');
    expect(screen.getByText('weeklyFrequency').tagName).toBe('CODE');
    // nenhum símbolo de markdown sobra na tela
    expect(document.body.textContent).not.toMatch(/\*\*|^##|`/m);
  });

  it('esconde o título da primeira linha quando o painel já mostra o nome', () => {
    const { rerender } = render(<MarkdownView content={FICHA} />);
    expect(screen.getByText('Especialista em Musculação')).toBeVisible();

    rerender(<MarkdownView content={FICHA} hideTitle />);
    expect(screen.queryByText('Especialista em Musculação')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Quem sou' })).toBeVisible();
  });

  it('mantém as quebras de linha simples do texto', () => {
    render(<MarkdownView content={FICHA} />);

    const paragraph = screen.getByText(/Evito:/);
    expect(paragraph.className).toContain('whitespace-pre-line');
    expect(paragraph.textContent).toContain('\nPrefiro:');
  });

  it('não executa nem exibe HTML solto como elemento', () => {
    const { container } = render(
      <MarkdownView
        content={'Texto <script>window.hacked = 1</script> <img src=x onerror="alert(1)">'}
      />,
    );

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('abre links externos em nova aba e remove protocolos perigosos', () => {
    render(<MarkdownView content={'[site](https://exemplo.com) e [ruim](javascript:alert(1))'} />);

    const external = screen.getByRole('link', { name: /site/ });
    expect(external).toHaveAttribute('target', '_blank');
    expect(external).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText('ruim').closest('a')?.getAttribute('href') ?? '').not.toMatch(
      /javascript/i,
    );
  });

  it('desenha tabelas dentro de um contêiner que rola na horizontal', () => {
    render(<MarkdownView content={'| Área | Regra |\n| --- | --- |\n| Segurança | Vence |'} />);

    expect(screen.getByRole('table')).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Área' })).toBeVisible();
    expect(screen.getByRole('table').parentElement?.className).toContain('overflow-x-auto');
  });
});

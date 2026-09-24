/**
 * Muscle map: a seleção nunca depende de hover — chips com `aria-pressed` controlam o
 * grupo ativo e o painel anuncia a mudança. O mapa anatômico é carregado sob demanda.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./muscle-map-figures', () => ({
  default: ({ selected, onSelect }: { selected: string; onSelect: (group: string) => void }) => (
    <button
      type="button"
      data-testid="figures"
      data-selected={selected}
      onClick={() => onSelect('triceps')}
    >
      corpo
    </button>
  ),
}));

import { MuscleMapExplorer } from './muscle-map-explorer';

describe('MuscleMapExplorer', () => {
  it('começa em Peito e troca pelo chip', async () => {
    const user = userEvent.setup();
    render(<MuscleMapExplorer />);
    expect(screen.getByRole('button', { name: 'Peito' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Progressão monitorada')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Ombros' }));
    expect(screen.getByRole('button', { name: 'Ombros' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Peito' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Carga ajustada após feedback')).toBeVisible();
  });

  it('clique no músculo do mapa também seleciona o grupo', async () => {
    const user = userEvent.setup();
    render(<MuscleMapExplorer />);
    const figures = await screen.findByTestId('figures');
    await user.click(figures);
    expect(screen.getByRole('button', { name: 'Tríceps' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('identifica o conteúdo como exemplo, não como dado de um aluno real', () => {
    render(<MuscleMapExplorer />);
    expect(screen.getByText(/Exemplo de protocolo/)).toBeVisible();
  });
});

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

const { getSwapOptions, substituteExercise, getExerciseCatalog } = vi.hoisted(() => ({
  getSwapOptions: vi.fn(),
  substituteExercise: vi.fn(),
  getExerciseCatalog: vi.fn(),
}));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getSwapOptions,
  substituteExercise,
  getExerciseCatalog,
}));

import { SwapGapResolution } from './swap-gap-resolution';

const ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  getSwapOptions.mockReset().mockResolvedValue({
    fromExerciseId: 'agachamento_livre',
    fromName: 'Agachamento livre',
    options: [
      { id: 'leg_press_45', name: 'Leg press 45' },
      { id: 'cadeira_extensora', name: 'Cadeira extensora' },
    ],
  });
  substituteExercise.mockReset().mockResolvedValue({ id: ID, status: 'RESOLVED' });
  getExerciseCatalog.mockReset().mockResolvedValue({ data: { versions: [], totalPublished: 0 } });
});

describe('SwapGapResolution', () => {
  it('lista os exercícios seguros e só troca depois de escolher e confirmar', async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(<SwapGapResolution caseId={ID} canAct onChanged={onChanged} />);

    expect(await screen.findByText(/Agachamento livre/, { selector: 'strong' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Trocar e enviar protocolo' })).toBeDisabled();

    await userEvent.selectOptions(screen.getByRole('combobox'), 'leg_press_45');
    await userEvent.click(screen.getByRole('button', { name: 'Trocar e enviar protocolo' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Trocar' }));

    await waitFor(() => expect(substituteExercise).toHaveBeenCalledWith(ID, 'leg_press_45'));
    expect(onChanged).toHaveBeenCalled();
  });

  it('oferece adicionar o exercício que falta ao catálogo', async () => {
    render(<SwapGapResolution caseId={ID} canAct onChanged={vi.fn()} />);
    await userEvent.click(await screen.findByRole('button', { name: /Adicionar ao catálogo/ }));
    expect(await screen.findByText('Novo exercício')).toBeVisible();
  });

  it('somente leitura: sem escolha nem botões de ação', async () => {
    render(<SwapGapResolution caseId={ID} canAct={false} onChanged={vi.fn()} />);
    expect(await screen.findByText(/Escolher o exercício da troca/)).toBeVisible();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Adicionar ao catálogo/ })).toBeNull();
  });
});

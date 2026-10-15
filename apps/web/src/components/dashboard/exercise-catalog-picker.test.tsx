import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExerciseCatalogOption } from '@/lib/dashboard-types';

const api = vi.hoisted(() => ({ searchExerciseCatalog: vi.fn() }));
vi.mock('@/lib/dashboard-api', () => ({
  DashboardApiError: class DashboardApiError extends Error {},
  ...api,
}));

import { ExerciseCatalogPicker, isUnlinkedExerciseId } from './exercise-catalog-picker';

const PROTOCOL_ID = '33333333-3333-4333-8333-333333333333';
const option = (over: Partial<ExerciseCatalogOption>): ExerciseCatalogOption => ({
  id: 'prancha',
  name: 'Prancha',
  pattern: 'CORE',
  muscleGroups: ['core'],
  equipment: [],
  measurement: 'DURATION',
  contraindicatedForStudent: [],
  ...over,
});
const PRANCHA = option({ contraindicatedForStudent: ['LOWER_BACK'] });
const ABDOMINAL = option({
  id: 'abdominal_maquina',
  name: 'Abdominal (Máquina)',
  equipment: ['máquina'],
  measurement: 'REPS',
});

/** Campo controlado, como o editor de protocolo o usa. */
function Harness({
  initial = { exerciseId: 'agachamento_goblet', name: 'Agachamento Goblet' },
  onPendingChange = vi.fn(),
}: {
  initial?: { exerciseId: string; name: string };
  onPendingChange?: (pending: boolean) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <ExerciseCatalogPicker
        exerciseId={value.exerciseId}
        name={value.name}
        protocolId={PROTOCOL_ID}
        onSelect={(selected) => setValue({ exerciseId: selected.id, name: selected.name })}
        onPendingChange={onPendingChange}
      />
      <output data-testid="selected">{`${value.exerciseId}|${value.name}`}</output>
    </>
  );
}

beforeEach(() => {
  api.searchExerciseCatalog.mockReset();
});

describe('ExerciseCatalogPicker', () => {
  it('busca enquanto digita (com debounce: uma requisição para a palavra inteira) e mostra detalhes', async () => {
    api.searchExerciseCatalog.mockResolvedValue([PRANCHA, ABDOMINAL]);
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Exercício do catálogo' });
    await userEvent.clear(input);
    await userEvent.type(input, 'abdominal prancha');

    expect(await screen.findByRole('option', { name: /Prancha/ })).toBeVisible();
    expect(api.searchExerciseCatalog).toHaveBeenCalledTimes(1);
    expect(api.searchExerciseCatalog).toHaveBeenCalledWith(
      'abdominal prancha',
      expect.objectContaining({ protocolId: PROTOCOL_ID }),
    );
    // Detalhes que diferenciam opções parecidas; contraindicação automática não é exibida
    // como bloqueio ou alerta no editor manual do profissional.
    expect(screen.getByRole('option', { name: /Abdominal \(Máquina\)/ })).toHaveTextContent(
      'Core · core · máquina',
    );
    expect(screen.getByRole('option', { name: /Prancha/ })).not.toHaveTextContent(
      'Catálogo contraindica para este aluno',
    );
  });

  it('seleção grava o id oficial e a grafia do catálogo', async () => {
    api.searchExerciseCatalog.mockResolvedValue([PRANCHA]);
    const onPendingChange = vi.fn();
    render(<Harness onPendingChange={onPendingChange} />);
    const input = screen.getByRole('combobox', { name: 'Exercício do catálogo' });
    await userEvent.clear(input);
    await userEvent.type(input, 'PRÂNCHA');
    await userEvent.click(await screen.findByRole('option', { name: /Prancha/ }));

    expect(screen.getByTestId('selected')).toHaveTextContent('prancha|Prancha');
    expect(input).toHaveValue('Prancha');
    expect(onPendingChange).toHaveBeenLastCalledWith(false);
  });

  it('teclado: setas escolhem a opção e Enter seleciona', async () => {
    api.searchExerciseCatalog.mockResolvedValue([PRANCHA, ABDOMINAL]);
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Exercício do catálogo' });
    await userEvent.clear(input);
    await userEvent.type(input, 'abd');
    await screen.findByRole('option', { name: /Abdominal/ });
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByTestId('selected')).toHaveTextContent(
      'abdominal_maquina|Abdominal (Máquina)',
    );
  });

  it('sem resultado: avisa e deixa ajustar a busca', async () => {
    api.searchExerciseCatalog.mockResolvedValue([]);
    render(<Harness />);
    const input = screen.getByRole('combobox', { name: 'Exercício do catálogo' });
    await userEvent.clear(input);
    await userEvent.type(input, 'xyzkw');
    expect(
      await screen.findByText(/Nenhum exercício encontrado para “xyzkw”\. Ajuste a busca/),
    ).toBeVisible();
  });

  it('texto digitado sem seleção fica pendente e Esc devolve a escolha atual sem sobrescrever', async () => {
    api.searchExerciseCatalog.mockResolvedValue([PRANCHA]);
    const onPendingChange = vi.fn();
    render(<Harness onPendingChange={onPendingChange} />);
    const input = screen.getByRole('combobox', { name: 'Exercício do catálogo' });
    await userEvent.clear(input);
    await userEvent.type(input, 'pran');
    expect(onPendingChange).toHaveBeenLastCalledWith(true);
    expect(screen.getByText(/Escolha um exercício da lista para confirmar/)).toBeVisible();

    await userEvent.keyboard('{Escape}');
    expect(input).toHaveValue('Agachamento Goblet');
    expect(screen.getByTestId('selected')).toHaveTextContent(
      'agachamento_goblet|Agachamento Goblet',
    );
    await waitFor(() => expect(onPendingChange).toHaveBeenLastCalledWith(false));
  });

  it('carrega a seleção atual ao editar um exercício já prescrito, sem buscar nada', () => {
    render(<Harness />);
    expect(screen.getByRole('combobox', { name: 'Exercício do catálogo' })).toHaveValue(
      'Agachamento Goblet',
    );
    expect(screen.getByText('Exercício do catálogo oficial.')).toBeVisible();
    expect(api.searchExerciseCatalog).not.toHaveBeenCalled();
  });

  it('exercício legado digitado à mão é sinalizado e já busca pelo próprio texto ao focar', async () => {
    api.searchExerciseCatalog.mockResolvedValue([PRANCHA]);
    render(<Harness initial={{ exerciseId: 'manual-c8b975ba', name: 'Abdominal na Prancha' }} />);
    expect(screen.getByText(/Exercício fora do catálogo/)).toBeVisible();
    await userEvent.click(screen.getByRole('combobox', { name: 'Exercício do catálogo' }));
    expect(await screen.findByRole('option', { name: /Prancha/ })).toBeVisible();
    expect(api.searchExerciseCatalog).toHaveBeenCalledWith(
      'Abdominal na Prancha',
      expect.anything(),
    );
  });

  it('marca como não vinculados os ids que nunca foram escolhidos no catálogo', () => {
    expect(isUnlinkedExerciseId('pending-1')).toBe(true);
    expect(isUnlinkedExerciseId('manual-1')).toBe(true);
    expect(isUnlinkedExerciseId('prancha')).toBe(false);
  });
});

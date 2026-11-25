import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

const { getTacoFoods } = vi.hoisted(() => ({ getTacoFoods: vi.fn() }));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getTacoFoods,
}));

import { TacoFoodsTable } from './knowledge-taco-table';

const meta = {
  generatedAt: '2026-11-01T12:00:00.000Z',
  timezone: 'America/Sao_Paulo' as const,
  dataQuality: [],
};

function food(code: number, name: string, category: string, over: Record<string, unknown> = {}) {
  return {
    id: `food-${code}`,
    code: String(code),
    origin: null,
    name,
    category,
    per100g: {
      energyKcal: 100 + code,
      proteinG: 2.6,
      fatG: 1,
      carbsG: 25.8,
      fiberG: 2.7,
      micros: { calcium_mg: 5, iron_mg: 0.3 },
      ...over,
    },
  };
}

/** 30 alimentos: 27 genéricos + um complemento (USDA) + Açaí e Arroz, que os testes procuram. */
const FOODS = [
  food(1, 'Arroz, integral, cozido', 'Cereais e derivados', { energyKcal: 124, fiberG: null }),
  food(2, 'Açaí, polpa, congelada', 'Frutas e derivados', { energyKcal: 58 }),
  {
    ...food(450, 'Leite, de vaca, integral', 'Leite e derivados', { energyKcal: 61 }),
    origin: 'USDA',
  },
  ...Array.from({ length: 27 }, (_, index) =>
    food(index + 3, `Alimento ${index + 3}`, 'Carnes e derivados'),
  ),
];

beforeEach(() => {
  getTacoFoods.mockReset().mockResolvedValue({ data: { foods: FOODS }, meta });
});

async function renderTable() {
  render(<TacoFoodsTable />);
  return within(await screen.findByRole('table', { name: /Alimentos da TACO/ }));
}

const bodyRows = (table: ReturnType<typeof within>) => table.getAllByRole('row').slice(1);

describe('TacoFoodsTable', () => {
  it('lista os alimentos importados com a composição por 100 g, 25 por página', async () => {
    const table = await renderTable();

    expect(bodyRows(table)).toHaveLength(25);
    const arroz = table.getByRole('row', { name: /Arroz, integral, cozido/ });
    expect(within(arroz).getByText('Cereais e derivados')).toBeVisible();
    expect(within(arroz).getByText('124')).toBeVisible();
    expect(within(arroz).getByText('25,8')).toBeVisible();
    expect(screen.getByText(/Mostrando/)).toHaveTextContent('Mostrando 1–25 de 30 alimento(s)');
  });

  it('marca os complementos com o selo da fonte e explica o selo', async () => {
    const user = userEvent.setup();
    const table = await renderTable();
    await user.type(screen.getByRole('searchbox', { name: 'Buscar alimento' }), 'leite');

    const leite = table.getByRole('row', { name: /Leite, de vaca, integral/ });
    expect(within(leite).getByText('USDA')).toHaveAttribute(
      'title',
      'Complemento: valores de USDA, não da TACO',
    );
    expect(screen.getByText(/complementos de outra fonte/)).toBeVisible();
  });

  it('mostra "—" onde o nutriente não foi analisado', async () => {
    const table = await renderTable();
    const arroz = table.getByRole('row', { name: /Arroz, integral, cozido/ });
    expect(within(arroz).getByText('—')).toBeVisible();
  });

  it('busca por nome sem acento e por número', async () => {
    const user = userEvent.setup();
    const table = await renderTable();
    const search = screen.getByRole('searchbox', { name: 'Buscar alimento' });

    await user.type(search, 'acai');
    expect(bodyRows(table)).toHaveLength(1);
    expect(table.getByText('Açaí, polpa, congelada')).toBeVisible();
    expect(screen.getByText(/Mostrando/)).toHaveTextContent('1 de 1 alimento(s) filtrado(s)');

    await user.clear(search);
    await user.type(search, '17');
    expect(table.getByText('Alimento 17')).toBeVisible();
  });

  it('filtra por categoria e mostra quantos há em cada uma', async () => {
    const user = userEvent.setup();
    const table = await renderTable();

    expect(screen.getByRole('option', { name: 'Frutas e derivados (1)' })).toBeInTheDocument();
    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Filtrar por categoria' }),
      'Frutas e derivados',
    );
    expect(bodyRows(table)).toHaveLength(1);
    expect(table.getByText('Açaí, polpa, congelada')).toBeVisible();
  });

  it('ordena pela coluna clicada: números do maior para o menor, e inverte no segundo clique', async () => {
    const user = userEvent.setup();
    const table = await renderTable();

    await user.click(table.getByRole('button', { name: /Energia \(kcal\)/ }));
    expect(bodyRows(table)[0]).toHaveTextContent('Alimento 29');

    await user.click(table.getByRole('button', { name: /Energia \(kcal\)/ }));
    expect(bodyRows(table)[0]).toHaveTextContent('Açaí, polpa, congelada');
  });

  it('micronutrientes entram e saem por um botão', async () => {
    const user = userEvent.setup();
    const table = await renderTable();
    expect(table.queryByRole('columnheader', { name: /Cálcio/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Micronutrientes' }));
    expect(screen.getByRole('button', { name: 'Micronutrientes' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(table.getByRole('columnheader', { name: /Cálcio \(mg\)/ })).toBeVisible();
    expect(table.getByRole('columnheader', { name: /Vitamina C/ })).toBeVisible();
  });

  it('pagina a lista', async () => {
    const user = userEvent.setup();
    const table = await renderTable();

    await user.click(screen.getByRole('button', { name: 'Próxima página' }));
    expect(bodyRows(table)).toHaveLength(5);
    expect(screen.getByText(/Mostrando/)).toHaveTextContent('Mostrando 26–30 de 30 alimento(s)');
  });

  it('sem resultado, explica em vez de mostrar uma tabela vazia', async () => {
    const user = userEvent.setup();
    const table = await renderTable();

    await user.type(screen.getByRole('searchbox', { name: 'Buscar alimento' }), 'zzzz');
    expect(table.getByText('Nenhum alimento encontrado com esses filtros.')).toBeVisible();
  });

  it('expõe a falha ao carregar', async () => {
    getTacoFoods.mockReset().mockRejectedValue(new Error('indisponível'));
    render(<TacoFoodsTable />);
    await waitFor(() => expect(getTacoFoods).toHaveBeenCalled());
    expect(await screen.findByText(/indisponível/)).toBeVisible();
  });
});

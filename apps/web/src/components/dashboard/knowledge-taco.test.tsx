import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

const { getTacoCatalog, getTacoFoods, importTacoCsv } = vi.hoisted(() => ({
  getTacoCatalog: vi.fn(),
  getTacoFoods: vi.fn(),
  importTacoCsv: vi.fn(),
}));

vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getTacoCatalog,
  getTacoFoods,
  importTacoCsv,
}));

import { KnowledgeTacoPanel, readCsvFile } from './knowledge-taco';

const meta = {
  generatedAt: '2026-10-31T12:00:00.000Z',
  timezone: 'America/Sao_Paulo' as const,
  dataQuality: [],
};

const empty = {
  data: { tacoCount: 0, otherCount: 28, lastImportedAt: null, categories: [], lastImport: null },
  meta,
};

const imported = {
  data: {
    tacoCount: 597,
    otherCount: 28,
    lastImportedAt: '2026-10-31T15:00:00.000Z',
    categories: [{ name: 'Cereais e derivados', count: 40 }],
    lastImport: { imported: 597, skipped: 2 },
  },
  meta,
};

function csvFile(name = 'taco.csv', content = 'Número do Alimento;Descrição\n1;Arroz') {
  return new File([content], name, { type: 'text/csv' });
}

beforeEach(() => {
  getTacoCatalog.mockReset().mockResolvedValue(empty);
  importTacoCsv.mockReset();
  getTacoFoods.mockReset().mockResolvedValue({
    data: {
      foods: [
        {
          id: 'food-1',
          code: '1',
          origin: null,
          name: 'Arroz, integral, cozido',
          category: 'Cereais e derivados',
          per100g: {
            energyKcal: 124,
            proteinG: 2.6,
            fatG: 1,
            carbsG: 25.8,
            fiberG: 2.7,
            micros: {},
          },
        },
      ],
    },
    meta,
  });
});

describe('KnowledgeTacoPanel', () => {
  it('mostra o resumo da base e o envio para quem pode importar', async () => {
    render(<KnowledgeTacoPanel canImport />);

    expect(await screen.findByText('Alimentos da TACO')).toBeVisible();
    expect(screen.getByText('Outros alimentos').nextElementSibling).toHaveTextContent('28');
    expect(screen.getByText('Última importação').nextElementSibling).toHaveTextContent('—');
    expect(screen.getByRole('button', { name: 'Escolher arquivo CSV' })).toBeEnabled();
  });

  it('sem nenhum alimento na base, avisa em vez de mostrar uma tabela vazia', async () => {
    getTacoCatalog.mockResolvedValue({ ...empty, data: { ...empty.data, otherCount: 0 } });
    render(<KnowledgeTacoPanel canImport />);

    expect(await screen.findByText(/Nenhum alimento da TACO importado ainda/)).toBeVisible();
    expect(getTacoFoods).not.toHaveBeenCalled();
  });

  it('só com complementos (sem TACO), a tabela aparece para conferência', async () => {
    render(<KnowledgeTacoPanel canImport />);

    expect(await screen.findByRole('table', { name: /Alimentos da TACO/ })).toBeVisible();
    expect(getTacoFoods).toHaveBeenCalledTimes(1);
  });

  it('com alimentos importados, mostra a tabela de conferência e a recarrega após importar', async () => {
    getTacoCatalog.mockResolvedValue(imported);
    importTacoCsv.mockResolvedValue({
      ...imported,
      data: { ...imported.data, lastImportedAt: '2026-11-01T10:00:00.000Z' },
    });
    render(<KnowledgeTacoPanel canImport />);

    expect(await screen.findByRole('table', { name: /Alimentos da TACO/ })).toBeVisible();
    expect(getTacoFoods).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByTestId('taco-file-input'), { target: { files: [csvFile()] } });

    await waitFor(() => expect(getTacoFoods).toHaveBeenCalledTimes(2));
  });

  it('não oferece importação sem a capability de escrita', async () => {
    render(<KnowledgeTacoPanel />);

    expect(await screen.findByText(/não importar a TACO/)).toBeVisible();
    expect(screen.queryByTestId('taco-file-input')).not.toBeInTheDocument();
  });

  it('importa o CSV, atualiza o resumo e informa as linhas ignoradas', async () => {
    importTacoCsv.mockResolvedValue(imported);
    render(<KnowledgeTacoPanel canImport />);
    await screen.findByText('Alimentos da TACO');

    fireEvent.change(screen.getByTestId('taco-file-input'), { target: { files: [csvFile()] } });

    expect(await screen.findByRole('status')).toHaveTextContent(
      '597 alimento(s) importado(s) de taco.csv. 2 linha(s) sem dados mínimos foram ignoradas.',
    );
    expect(importTacoCsv).toHaveBeenCalledWith({
      csv: 'Número do Alimento;Descrição\n1;Arroz',
      fileName: 'taco.csv',
    });
    expect(screen.getByText('Alimentos da TACO').nextElementSibling).toHaveTextContent('597');
    expect(
      within(screen.getByRole('region', { name: 'Categorias importadas' })).getByText(
        'Cereais e derivados',
      ),
    ).toBeVisible();
  });

  it('mostra o motivo quando a API recusa o arquivo', async () => {
    importTacoCsv.mockRejectedValue(new Error('Valores fora do esperado; nada foi importado.'));
    render(<KnowledgeTacoPanel canImport />);
    await screen.findByText('Alimentos da TACO');

    fireEvent.change(screen.getByTestId('taco-file-input'), { target: { files: [csvFile()] } });

    expect(await screen.findByRole('alert')).toHaveTextContent('nada foi importado');
    expect(screen.getByText('Alimentos da TACO').nextElementSibling).toHaveTextContent('0');
  });

  it('expõe falha ao carregar o resumo', async () => {
    getTacoCatalog.mockReset().mockRejectedValue(new Error('indisponível'));
    render(<KnowledgeTacoPanel canImport />);
    await waitFor(() => expect(getTacoCatalog).toHaveBeenCalled());
    expect(await screen.findByText(/indisponível/)).toBeVisible();
  });
});

describe('readCsvFile', () => {
  it('lê UTF-8 e remove o BOM', async () => {
    expect(await readCsvFile(csvFile('a.csv', '﻿Descrição;Energia'))).toBe('Descrição;Energia');
  });

  it('cai para Windows-1252 quando o arquivo não é UTF-8 válido', async () => {
    // "Proteína" em Windows-1252: o "í" é o byte 0xED, inválido como UTF-8.
    const bytes = new Uint8Array([0x50, 0x72, 0x6f, 0x74, 0x65, 0xed, 0x6e, 0x61]);
    const file = new File([bytes], 'taco.csv', { type: 'text/csv' });
    expect(await readCsvFile(file)).toBe('Proteína');
  });
});

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ControlCenterStudentSummary } from '@movivo/shared';

import type * as ControlCenterApi from '@/lib/control-center-api';

import { studentsResponse } from '../../../test/control-center-fixtures';

const { getStudents } = vi.hoisted(() => ({ getStudents: vi.fn() }));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getStudents,
}));

import { ControlCenterApiError } from '@/lib/control-center-api';

import { StudentsDashboard } from './students-dashboard';

beforeEach(() => getStudents.mockReset());

function dataRows(table: HTMLElement) {
  return within(table).getAllByRole('row').slice(1);
}

async function search() {
  await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
}

/**
 * Status e Plano deixaram de ser `<select>` nativo (achado 2026-08-19, a pedido do
 * fundador): agora são Radix Select. A interação é a de um combobox de verdade —
 * abre o menu no gatilho e escolhe um `option` —, não mais `selectOptions`.
 */
async function chooseOption(trigger: HTMLElement, option: string) {
  await userEvent.click(trigger);
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

function filterSelects(): [HTMLElement, HTMLElement] {
  const [status, plan] = screen.getAllByRole('combobox');
  if (!status || !plan) throw new Error('combos de filtro não encontrados');
  return [status, plan];
}

describe('StudentsDashboard', () => {
  it('lista todos os alunos numa tabela com nome, status, plano, whatsapp, e-mail e data de inscrição', async () => {
    getStudents.mockResolvedValue(studentsResponse);
    render(<StudentsDashboard canReadHealth />);
    const table = await screen.findByRole('table');

    // Ordem das colunas (a pedido do fundador): o nome abre a linha.
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent?.trim())).toEqual(
      ['Nome', 'Status', 'Plano', 'WhatsApp', 'E-mail', 'Data de inscrição'],
    );

    const anaRow = within(table).getByText('Ana Souza').closest('tr') as HTMLElement;
    expect(within(anaRow).getByText('Ativo')).toBeVisible();
    expect(within(anaRow).getByText('Teste')).toBeVisible();
    expect(within(anaRow).getByText('+55 (11) 99999-0001')).toBeVisible();
    expect(within(anaRow).getByText('ana@teste.com')).toBeVisible();
    expect(within(anaRow).getByText('01/08/2026')).toBeVisible();
    expect(within(anaRow).getByRole('link', { name: 'Ana Souza' })).toHaveAttribute(
      'href',
      `/dashboard/alunos/${studentsResponse.data.students[0]?.id}`,
    );

    const unnamedRow = within(table).getByText('Nome não informado').closest('tr') as HTMLElement;
    expect(within(unnamedRow).getByText('Desativado')).toBeVisible();
    expect(within(unnamedRow).getAllByText('Não informado')).toHaveLength(3); // plano, e-mail, data
    expect(within(unnamedRow).getByText('+55 (11) 99999-0002')).toBeVisible();
  });

  it('sem `canReadHealth` (recorte de suporte) a tabela continua acessível, sem promessa de saúde', async () => {
    getStudents.mockResolvedValue(studentsResponse);
    render(<StudentsDashboard />);
    await screen.findByRole('table');
    expect(screen.getAllByRole('link', { name: /Ana Souza|Nome não informado/ })).toHaveLength(2);
    expect(screen.getByText(/Dados de saúde não fazem parte deste acesso/)).toBeVisible();
  });

  // Achado 2026-08-19 (a pedido do fundador): "Limpar filtro" virou botão permanente da
  // faixa de controles, ao lado de "Buscar" — não mais um link que nasce e morre junto
  // com a faixa de chips. Os chips seguem condicionados ao que está APLICADO.
  it('"Buscar" e "Limpar filtro" ficam sempre visíveis; só os chips dependem do filtro aplicado', async () => {
    getStudents.mockResolvedValue(studentsResponse);
    render(<StudentsDashboard />);
    await screen.findByRole('table');
    expect(screen.getByRole('button', { name: 'Buscar' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Limpar filtro' })).toBeVisible();
    expect(screen.queryByText(/^Busca:/)).not.toBeInTheDocument();

    await userEvent.type(screen.getByRole('searchbox'), 'ana@');
    // Digitar não basta: o chip reflete o que está APLICADO, não o rascunho.
    expect(screen.queryByText(/^Busca:/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Limpar filtro' })).toBeVisible();

    await search();
    expect(screen.getByText('Busca: "ana@"')).toBeVisible();
    // O antigo "Limpar tudo" da faixa de chips saiu: quem limpa é o botão permanente.
    expect(screen.queryByRole('button', { name: 'Limpar tudo' })).not.toBeInTheDocument();
  });

  // Sem filtro aplicado o botão não fica desabilitado — clicar é um no-op inofensivo.
  it('"Limpar filtro" sem nenhum filtro aplicado não muda a lista', async () => {
    getStudents.mockResolvedValue(studentsResponse);
    render(<StudentsDashboard />);
    const table = await screen.findByRole('table');

    const clear = screen.getByRole('button', { name: 'Limpar filtro' });
    expect(clear).toBeEnabled();
    await userEvent.click(clear);
    expect(dataRows(table)).toHaveLength(2);
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });

  it('mostra um chip por filtro aplicado e remove só aquele filtro no ×', async () => {
    getStudents.mockResolvedValue(studentsResponse);
    render(<StudentsDashboard />);
    const table = await screen.findByRole('table');
    const [statusSelect, planSelect] = filterSelects();

    await userEvent.type(screen.getByRole('searchbox'), 'ana');
    await chooseOption(statusSelect, 'Ativo');
    await chooseOption(planSelect, 'Teste');
    fireEvent.change(screen.getByLabelText('Período de inscrição, de'), {
      target: { value: '2026-08-01' },
    });
    await search();

    expect(screen.getByText('Busca: "ana"')).toBeVisible();
    expect(screen.getByText('Status: Ativo')).toBeVisible();
    expect(screen.getByText('Plano: Teste')).toBeVisible();
    expect(screen.getByText('Período: 01/08/2026')).toBeVisible();
    expect(dataRows(table)).toHaveLength(1);

    // Remover o chip reaplica na hora — sem exigir um novo clique em "Buscar".
    await userEvent.click(screen.getByRole('button', { name: 'Remover filtro Status' }));
    expect(screen.queryByText('Status: Ativo')).not.toBeInTheDocument();
    // O gatilho do combo é um botão: o "valor" é o rótulo que ele mostra.
    expect(statusSelect).toHaveTextContent('Todos');
    expect(screen.getByText('Plano: Teste')).toBeVisible();

    await userEvent.click(
      screen.getByRole('button', { name: 'Remover filtro Período de inscrição' }),
    );
    expect(screen.queryByText(/^Período:/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('Período de inscrição, de')).toHaveValue('');

    await userEvent.click(screen.getByRole('button', { name: 'Remover filtro Busca' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remover filtro Plano' }));
    // Sem chip nenhum a faixa de chips some — mas "Limpar filtro" continua ali.
    expect(screen.queryByText(/^(Busca|Status|Plano|Período):/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Limpar filtro' })).toBeVisible();
    expect(dataRows(table)).toHaveLength(2);
  });

  it('o chip de período mostra o intervalo quando os dois extremos estão preenchidos', async () => {
    getStudents.mockResolvedValue(studentsResponse);
    render(<StudentsDashboard />);
    await screen.findByRole('table');

    // Só "até": data específica, mesmo chip de um extremo só.
    fireEvent.change(screen.getByLabelText('Período de inscrição, até'), {
      target: { value: '2026-08-01' },
    });
    await search();
    expect(screen.getByText('Período: 01/08/2026')).toBeVisible();

    fireEvent.change(screen.getByLabelText('Período de inscrição, de'), {
      target: { value: '2026-07-01' },
    });
    await search();
    expect(screen.getByText('Período: 01/07/2026 – 01/08/2026')).toBeVisible();
  });

  // WCAG 2.1.1: o container que rola na horizontal precisa ser alcançável por teclado.
  it('expõe a área de rolagem da tabela como região focável', async () => {
    getStudents.mockResolvedValue(studentsResponse);
    render(<StudentsDashboard />);
    await screen.findByRole('table');
    expect(screen.getByRole('region', { name: 'Tabela da base de alunos' })).toHaveAttribute(
      'tabindex',
      '0',
    );
  });

  it('a busca livre (nome, whatsapp ou e-mail) só filtra ao clicar em "Buscar"', async () => {
    getStudents.mockResolvedValue(studentsResponse);
    render(<StudentsDashboard />);
    const table = await screen.findByRole('table');
    const searchInput = screen.getByRole('searchbox');

    await userEvent.type(searchInput, 'ana@');
    expect(dataRows(table)).toHaveLength(2); // ainda não buscou — lista completa

    await search();
    expect(dataRows(table)).toHaveLength(1);
    expect(within(table).getByText('Ana Souza')).toBeVisible();

    await userEvent.clear(searchInput);
    await userEvent.type(searchInput, 'ninguém');
    await search();
    expect(
      await screen.findByText('Nenhum aluno encontrado para os filtros aplicados.'),
    ).toBeVisible();
  });

  it('filtra por status da assinatura', async () => {
    getStudents.mockResolvedValue(studentsResponse);
    render(<StudentsDashboard />);
    const table = await screen.findByRole('table');
    const [statusSelect] = filterSelects();

    await chooseOption(statusSelect, 'Ativo');
    await search();
    expect(dataRows(table)).toHaveLength(1);
    expect(within(table).getByText('Ana Souza')).toBeVisible();

    await chooseOption(statusSelect, 'Desativado');
    await search();
    expect(dataRows(table)).toHaveLength(1);
    expect(within(table).getByText('Nome não informado')).toBeVisible();
  });

  it('filtra por plano, combinando com a busca livre', async () => {
    getStudents.mockResolvedValue(studentsResponse);
    render(<StudentsDashboard />);
    const table = await screen.findByRole('table');
    const [, planSelect] = filterSelects();

    await chooseOption(planSelect, 'Teste');
    await search();
    expect(dataRows(table)).toHaveLength(1);
    expect(within(table).getByText('Ana Souza')).toBeVisible();

    // Combinação: plano "Teste" + busca por um nome que não existe nesse plano.
    await userEvent.type(screen.getByRole('searchbox'), 'ninguém');
    await search();
    expect(
      await screen.findByText('Nenhum aluno encontrado para os filtros aplicados.'),
    ).toBeVisible();
  });

  it('"Limpar filtro" restaura a lista completa sem precisar clicar em "Buscar"', async () => {
    getStudents.mockResolvedValue(studentsResponse);
    render(<StudentsDashboard />);
    const table = await screen.findByRole('table');

    await userEvent.type(screen.getByRole('searchbox'), 'ana@');
    await search();
    expect(dataRows(table)).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Limpar filtro' }));
    expect(dataRows(table)).toHaveLength(2);
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });

  it('ordena a tabela por qualquer coluna ao clicar no cabeçalho, alternando a direção', async () => {
    getStudents.mockResolvedValue(studentsResponse);
    render(<StudentsDashboard />);
    const table = await screen.findByRole('table');
    const nameHeader = screen.getByRole('button', { name: /^Nome/ });

    await userEvent.click(nameHeader);
    expect(within(dataRows(table)[0] as HTMLElement).getByText('Ana Souza')).toBeVisible();
    expect(screen.getByRole('columnheader', { name: /^Nome/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );

    await userEvent.click(nameHeader);
    expect(within(dataRows(table)[0] as HTMLElement).getByText('Nome não informado')).toBeVisible();
    expect(screen.getByRole('columnheader', { name: /^Nome/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  /*
   * Achado 2026-08-19 (a pedido do fundador, pela segunda vez): a grade vertical entre
   * as colunas e o título de coluna centralizado voltaram. Um redesenho anterior tirou
   * os dois por conta própria — o teste existe para que isso não se repita em silêncio.
   */
  it('desenha a grade vertical entre as colunas, no cabeçalho e em cada linha', async () => {
    getStudents.mockResolvedValue(studentsResponse);
    render(<StudentsDashboard />);
    const table = await screen.findByRole('table');

    for (const row of within(table).getAllByRole('row')) {
      expect(row).toHaveClass('divide-x', 'divide-border');
      // A hairline horizontal é aditiva: a grade não substitui o traço entre linhas.
      expect(row).toHaveClass('border-b', 'border-border');
    }
  });

  it('centraliza o título de TODA coluna, inclusive o da data (cujo dado fica à esquerda)', async () => {
    getStudents.mockResolvedValue(studentsResponse);
    render(<StudentsDashboard />);
    const table = await screen.findByRole('table');

    for (const header of screen.getAllByRole('columnheader')) {
      expect(header).toHaveClass('text-center');
      expect(header).not.toHaveClass('text-right');
    }

    // Achado 2026-08-20 (a pedido do fundador): a data de inscrição passou de
    // alinhada à direita (padrão de `TD_NUM`) para à esquerda — só nesta coluna.
    const anaRow = within(table).getByText('Ana Souza').closest('tr') as HTMLElement;
    expect(within(anaRow).getByText('01/08/2026')).toHaveClass('text-left');
    expect(within(anaRow).getByText('01/08/2026')).not.toHaveClass('text-right');
  });

  /*
   * Achado 2026-08-19 (a pedido do fundador, terceira rodada de ajuste de largura):
   * a busca ganhou linha própria de largura total — dividir a faixa com Status/Plano/
   * Período sempre a deixava espremida na sobra, e só alargar o teto não resolvia
   * porque a 1280–1440px ela nunca CHEGAVA a bater nele. O teste existe para que uma
   * futura tentativa de "economizar espaço" não a espreme de volta em silêncio.
   */
  it('a busca ocupa a linha inteira, isolada dos demais filtros', async () => {
    getStudents.mockResolvedValue(studentsResponse);
    render(<StudentsDashboard />);
    await screen.findByRole('table');

    const searchField = screen.getByRole('searchbox').closest('label');
    expect(searchField).toHaveClass('lg:w-full');
  });

  /*
   * Achado 2026-08-19 (a pedido do fundador): os combos abrem ANCORADOS abaixo do
   * gatilho. O `<select>` nativo do Chromium abre a lista centrada na opção
   * selecionada — com "Desativado" escolhido, o menu nascia por cima do campo. O
   * `data-radix-popper-content-wrapper` só existe com `position="popper"`; voltar ao
   * padrão `item-aligned` do Radix faria este teste cair.
   */
  it('abre os combos ancorados abaixo do gatilho, com os rótulos do filtro', async () => {
    getStudents.mockResolvedValue(studentsResponse);
    render(<StudentsDashboard />);
    await screen.findByRole('table');
    const [statusSelect, planSelect] = filterSelects();

    expect(statusSelect).toHaveAccessibleName('Status da assinatura');
    expect(planSelect).toHaveAccessibleName('Plano');
    expect(statusSelect).toHaveTextContent('Todos');

    await userEvent.click(statusSelect);
    expect(statusSelect).toHaveAttribute('aria-expanded', 'true');
    const listbox = await screen.findByRole('listbox');
    expect(listbox.closest('[data-radix-popper-content-wrapper]')).not.toBeNull();
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((item) => item.textContent),
    ).toEqual(['Todos', 'Ativo', 'Desativado']);

    // Esc fecha sem escolher — teclado de combobox que o Radix já entrega.
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(statusSelect).toHaveTextContent('Todos');
  });

  it('mostra o vazio de escopo quando não há aluno atribuído', async () => {
    getStudents.mockResolvedValue({
      ...studentsResponse,
      data: { ...studentsResponse.data, students: [] },
    });
    render(<StudentsDashboard />);
    expect(await screen.findByRole('heading', { name: 'Nenhum aluno neste escopo' })).toBeVisible();
  });

  it('em 403 não oferece nova tentativa', async () => {
    getStudents.mockRejectedValueOnce(new ControlCenterApiError(403, 'Sem acesso aos alunos.'));
    render(<StudentsDashboard />);
    expect(
      await screen.findByRole('heading', { name: 'Este setor não faz parte do seu acesso' }),
    ).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('preserva a última lista concluída quando a atualização falha', async () => {
    getStudents
      .mockResolvedValueOnce(studentsResponse)
      .mockRejectedValueOnce(new ControlCenterApiError(500, 'Servidor indisponível.'));
    render(<StudentsDashboard />);
    await userEvent.click(await screen.findByRole('button', { name: 'Atualizar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Os dados abaixo são da última atualização concluída.',
    );
    expect(screen.getByText('Ana Souza')).toBeVisible();
  });

  // Achado 2026-08-19 (a pedido do fundador): a linha "Atualizado em" saiu do topo.
  it('não mostra mais "Atualizado em" no topo da tela', async () => {
    getStudents.mockResolvedValue(studentsResponse);
    render(<StudentsDashboard />);
    await screen.findByRole('table');
    expect(screen.queryByText(/Atualizado em/)).not.toBeInTheDocument();
  });

  // Achado 2026-08-19 (spec de Sofia): a contagem desceu para o rodapé do cartão da
  // tabela — fora da <table>, mas dentro do mesmo cartão, e anunciada por aria-live.
  it('mostra a contagem no rodapé do cartão, fora da tabela e com anúncio educado', async () => {
    getStudents.mockResolvedValue(studentsResponse);
    render(<StudentsDashboard />);
    const table = await screen.findByRole('table');
    const count = screen.getByText(/Mostrando/);
    expect(count).toHaveTextContent('Mostrando 1–2 de 2 aluno(s)');
    expect(count).toHaveAttribute('aria-live', 'polite');
    expect(within(table).queryByText(/Mostrando/)).not.toBeInTheDocument();
  });

  it('o vazio de filtro vive dentro da tabela e zera a contagem', async () => {
    getStudents.mockResolvedValue(studentsResponse);
    render(<StudentsDashboard />);
    const table = await screen.findByRole('table');

    await userEvent.type(screen.getByRole('searchbox'), 'ninguém');
    await search();

    const empty = await within(table).findByText(
      'Nenhum aluno encontrado para os filtros aplicados.',
    );
    expect(empty).toHaveAttribute('colspan', '6');
    expect(screen.getByText(/Mostrando/)).toHaveTextContent('Mostrando 0 de 0 aluno(s)');
  });

  it('filtra por período de inscrição: um campo só = data específica; os dois = intervalo', async () => {
    getStudents.mockResolvedValue(studentsResponse);
    render(<StudentsDashboard />);
    const table = await screen.findByRole('table');
    expect(screen.getByText('Período de inscrição')).toBeVisible();
    const from = screen.getByLabelText('Período de inscrição, de');
    const to = screen.getByLabelText('Período de inscrição, até');

    // Só "De" preenchido: data específica, não um intervalo aberto pra frente.
    fireEvent.change(from, { target: { value: '2026-08-01' } });
    await search();
    expect(dataRows(table)).toHaveLength(1);
    expect(within(table).getByText('Ana Souza')).toBeVisible();

    // Intervalo (os dois campos) que não cobre a data de Ana: aluno sem data de
    // inscrição nunca casa com o filtro.
    fireEvent.change(from, { target: { value: '2026-09-01' } });
    fireEvent.change(to, { target: { value: '2026-09-30' } });
    await search();
    expect(
      await screen.findByText('Nenhum aluno encontrado para os filtros aplicados.'),
    ).toBeVisible();
  });

  it('pagina de 50 em 50 alunos', async () => {
    const many: ControlCenterStudentSummary[] = Array.from({ length: 60 }, (_, index) => ({
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`,
      name: `Aluno ${String(index).padStart(2, '0')}`,
      email: `aluno${index}@teste.com`,
      phoneNumber: '+5511999990000',
      status: 'ACTIVE',
      subscriptionStatus: 'ACTIVE',
      subscriptionPlan: 'MONTHLY',
      protocolStatus: null,
      enrolledAt: `2026-08-${String((index % 28) + 1).padStart(2, '0')}T09:00:00.000Z`,
      churnRisk: { score: 0, signals: [] },
    }));
    getStudents.mockResolvedValue({
      ...studentsResponse,
      data: { ...studentsResponse.data, students: many },
    });
    render(<StudentsDashboard />);
    const table = await screen.findByRole('table');

    expect(screen.getByText('1 / 2')).toBeVisible();
    expect(dataRows(table)).toHaveLength(50);
    expect(screen.getByRole('button', { name: 'Página anterior' })).toBeDisabled();
    expect(screen.getByText(/Mostrando/)).toHaveTextContent('Mostrando 1–50 de 60 aluno(s)');

    await userEvent.click(screen.getByRole('button', { name: 'Próxima página' }));
    expect(screen.getByText('2 / 2')).toBeVisible();
    expect(dataRows(table)).toHaveLength(10);
    expect(screen.getByRole('button', { name: 'Próxima página' })).toBeDisabled();
    expect(screen.getByText(/Mostrando/)).toHaveTextContent('Mostrando 51–60 de 60 aluno(s)');

    await userEvent.click(screen.getByRole('button', { name: 'Página anterior' }));
    expect(screen.getByText('1 / 2')).toBeVisible();
    expect(dataRows(table)).toHaveLength(50);
  });
});

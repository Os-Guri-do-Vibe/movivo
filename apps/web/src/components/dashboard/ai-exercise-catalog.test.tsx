/**
 * Testes do painel "Exercícios" (`AiExerciseCatalogDashboard`): a base de referência
 * administrável que a IA usa para montar protocolos. Cobre a lista (só a versão PUBLISHED
 * mais recente de cada chave), busca/filtros com chips, paginação, e o CRUD completo
 * (criar com chave derivada do nome, editar preservando campos técnicos, excluir via
 * confirmação destrutiva) atrás da capability `canWrite`.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';
import type { ExerciseCatalogEntryVersion, ExerciseCatalogResponse } from '@movivo/shared';

const { getExerciseCatalog, publishExerciseCatalogEntry, retireExerciseCatalogEntry } = vi.hoisted(
  () => ({
    getExerciseCatalog: vi.fn(),
    publishExerciseCatalogEntry: vi.fn(),
    retireExerciseCatalogEntry: vi.fn(),
  }),
);

vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getExerciseCatalog,
  publishExerciseCatalogEntry,
  retireExerciseCatalogEntry,
}));

import { ControlCenterApiError } from '@/lib/control-center-api';

import { AiExerciseCatalogDashboard } from './ai-exercise-catalog';

const meta = {
  generatedAt: '2026-08-20T12:00:00.000Z',
  timezone: 'America/Sao_Paulo' as const,
  dataQuality: [],
};

const supino: ExerciseCatalogEntryVersion = {
  id: '11111111-1111-4111-8111-111111111111',
  exerciseKey: 'supino_reto',
  name: 'Supino reto',
  pattern: 'HORIZONTAL_PUSH',
  muscleGroups: ['peito'],
  equipment: ['barra'],
  locations: ['FULL_GYM'],
  minLevel: 'INICIANTE',
  contraindicatedFor: ['SHOULDER'],
  substitutes: [],
  videoUrl: 'https://videos.test/supino',
  version: 3,
  status: 'PUBLISHED',
  changeNote: 'Publicado inicialmente',
  createdBy: 'Rodrigo',
  createdAt: '2026-08-20T12:00:00.000Z',
  current: true,
};

const agachamento: ExerciseCatalogEntryVersion = {
  id: '22222222-2222-4222-8222-222222222222',
  exerciseKey: 'agachamento_livre',
  name: 'Agachamento livre',
  pattern: 'SQUAT',
  muscleGroups: ['quadríceps', 'glúteo'],
  equipment: [],
  locations: ['FULL_GYM', 'HOME'],
  minLevel: 'INTERMEDIARIO',
  contraindicatedFor: [],
  substitutes: [],
  version: 1,
  status: 'PUBLISHED',
  changeNote: 'Publicado inicialmente',
  createdBy: 'Rodrigo',
  createdAt: '2026-08-21T12:00:00.000Z',
  current: true,
};

/** Retirado: some da lista mesmo sendo a versão `current` da chave. */
const flexaoRetirada: ExerciseCatalogEntryVersion = {
  id: '33333333-3333-4333-8333-333333333333',
  exerciseKey: 'flexao_de_braco',
  name: 'Flexão de braço',
  pattern: 'HORIZONTAL_PUSH',
  muscleGroups: ['peito'],
  equipment: [],
  locations: ['HOME'],
  minLevel: 'INICIANTE',
  contraindicatedFor: [],
  substitutes: [],
  version: 2,
  status: 'RETIRED',
  changeNote: 'Retirado por duplicidade',
  createdBy: 'Rodrigo',
  createdAt: '2026-08-22T12:00:00.000Z',
  current: true,
};

/** Versão antiga (não `current`) da mesma chave do supino: some da lista, mas conta para `existingKeys`. */
const supinoAntigo: ExerciseCatalogEntryVersion = {
  id: '44444444-4444-4444-8444-444444444444',
  exerciseKey: 'supino_reto',
  name: 'Supino reto (antigo)',
  pattern: 'HORIZONTAL_PUSH',
  muscleGroups: ['peito'],
  equipment: ['barra'],
  locations: ['FULL_GYM'],
  minLevel: 'INICIANTE',
  contraindicatedFor: [],
  substitutes: [],
  version: 2,
  status: 'PUBLISHED',
  changeNote: 'Versão anterior',
  createdBy: 'Rodrigo',
  createdAt: '2026-08-19T12:00:00.000Z',
  current: false,
};

function buildResponse(versions: ExerciseCatalogEntryVersion[]): ExerciseCatalogResponse {
  return {
    data: { versions, totalPublished: versions.filter((v) => v.status === 'PUBLISHED').length },
    meta,
  };
}

const response = buildResponse([supinoAntigo, supino, agachamento, flexaoRetirada]);

function manyPublishedVersions(count: number): ExerciseCatalogEntryVersion[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`,
    exerciseKey: `exercicio_${index}`,
    name: `Exercício ${String(index).padStart(2, '0')}`,
    pattern: 'ISOLATION',
    muscleGroups: ['core'],
    equipment: [],
    locations: ['HOME'],
    minLevel: 'INICIANTE',
    contraindicatedFor: [],
    substitutes: [],
    version: 1,
    status: 'PUBLISHED',
    changeNote: 'seed de paginação',
    createdBy: 'Rodrigo',
    createdAt: '2026-08-20T12:00:00.000Z',
    current: true,
  }));
}

beforeEach(() => {
  getExerciseCatalog.mockReset().mockResolvedValue(response);
  publishExerciseCatalogEntry.mockReset().mockResolvedValue(response);
  retireExerciseCatalogEntry.mockReset().mockResolvedValue(response);
});

describe('AiExerciseCatalogDashboard', () => {
  it('lista só a versão PUBLISHED e current de cada chave, sem controles de escrita', async () => {
    render(<AiExerciseCatalogDashboard />);

    expect(await screen.findByText('Supino reto')).toBeVisible();
    expect(screen.getByText('Agachamento livre')).toBeVisible();
    expect(screen.queryByText('Flexão de braço')).not.toBeInTheDocument();
    expect(screen.queryByText('Supino reto (antigo)')).not.toBeInTheDocument();

    expect(screen.queryByRole('button', { name: 'Novo exercício' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar Supino reto' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Excluir Supino reto' })).not.toBeInTheDocument();

    expect(screen.getByText('peito | Academia completa')).toBeVisible();
    expect(screen.getByText('quadríceps, glúteo | Academia completa, Em casa')).toBeVisible();
  });

  it('em 403 explica o bloqueio sem oferecer nova tentativa', async () => {
    getExerciseCatalog
      .mockReset()
      .mockRejectedValue(new ControlCenterApiError(403, 'Sem acesso ao catálogo.'));
    render(<AiExerciseCatalogDashboard />);
    expect(
      await screen.findByRole('heading', { name: 'Este setor não faz parte do seu acesso' }),
    ).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('busca por nome só filtra após "Buscar", com chip removível e "Limpar filtro"', async () => {
    const user = userEvent.setup();
    render(<AiExerciseCatalogDashboard />);
    await screen.findByText('Supino reto');

    const searchInput = screen.getByPlaceholderText('Nome do exercício');
    await user.type(searchInput, 'agachamento');
    expect(screen.getByText('Supino reto')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(screen.queryByText('Supino reto')).not.toBeInTheDocument();
    expect(screen.getByText('Agachamento livre')).toBeVisible();
    expect(screen.getByText('Nome: "agachamento"')).toBeVisible();
    expect(
      screen.getByText(/exercício\(s\) encontrado\(s\) para o filtro aplicado\./),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Remover filtro Nome' }));
    expect(screen.getByText('Supino reto')).toBeVisible();
    expect(screen.queryByText('Nome: "agachamento"')).not.toBeInTheDocument();

    await user.type(searchInput, 'zzz-inexistente');
    await user.click(screen.getByRole('button', { name: 'Limpar filtro' }));
    expect(searchInput).toHaveValue('');
    expect(screen.getByText('Supino reto')).toBeVisible();
    expect(screen.getByText('Agachamento livre')).toBeVisible();
  });

  it('sem resultado no filtro aplicado, mostra o estado vazio e a contagem zerada', async () => {
    const user = userEvent.setup();
    render(<AiExerciseCatalogDashboard />);
    await screen.findByText('Supino reto');

    await user.type(screen.getByPlaceholderText('Nome do exercício'), 'inexistente-xyz');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));

    expect(await screen.findByText('Nenhum exercício encontrado.')).toBeVisible();
    expect(screen.getByText('0')).toBeVisible();
    expect(
      screen.getByText('exercício(s) encontrado(s) para o filtro aplicado.', { exact: false }),
    ).toBeVisible();
    // Sem itens, o rodapé de paginação/contagem some — só o estado vazio explica o zero.
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('filtra por músculo e por local, com chip próprio para cada um', async () => {
    const user = userEvent.setup();
    render(<AiExerciseCatalogDashboard />);
    await screen.findByText('Supino reto');

    await user.click(screen.getByRole('checkbox', { name: 'quadríceps' }));
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(screen.queryByText('Supino reto')).not.toBeInTheDocument();
    expect(screen.getByText('Agachamento livre')).toBeVisible();
    expect(screen.getByText('Músculo: quadríceps')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Remover filtro Músculo' }));
    expect(screen.getByText('Supino reto')).toBeVisible();
    expect(screen.queryByText('Músculo: quadríceps')).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Em casa' }));
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(screen.queryByText('Supino reto')).not.toBeInTheDocument();
    expect(screen.getByText('Agachamento livre')).toBeVisible();
    expect(screen.getByText(/Local: Em casa/)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Remover filtro Local' }));
    expect(screen.getByText('Supino reto')).toBeVisible();
  });

  it('pagina resultados acima de 50 itens, com contagem e navegação corretas', async () => {
    getExerciseCatalog.mockReset().mockResolvedValue(buildResponse(manyPublishedVersions(55)));
    const user = userEvent.setup();
    render(<AiExerciseCatalogDashboard />);

    await screen.findByText('Exercício 00');
    const list = screen.getByRole('list', { name: 'Catálogo de exercícios' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(50);
    expect(screen.getByText(/Mostrando/).textContent).toContain('1');
    expect(screen.getByText(/Mostrando/).textContent).toContain('50');
    expect(screen.getByText(/Mostrando/).textContent).toContain('55');

    const nav = screen.getByRole('navigation', { name: 'Paginação do catálogo de exercícios' });
    expect(within(nav).getByText('1 / 2')).toBeVisible();
    await user.click(within(nav).getByRole('button', { name: 'Próxima página' }));

    expect(within(nav).getByText('2 / 2')).toBeVisible();
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(within(nav).getByRole('button', { name: 'Próxima página' })).toBeDisabled();
  });

  it('cria um exercício novo com chave derivada do nome, resolvendo colisão com uma chave existente', async () => {
    const user = userEvent.setup();
    render(<AiExerciseCatalogDashboard canWrite />);
    await screen.findByText('Supino reto');

    await user.click(screen.getByRole('button', { name: 'Novo exercício' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Novo exercício' })).toBeVisible();
    const salvar = within(dialog).getByRole('button', { name: 'Salvar' });
    expect(salvar).toBeDisabled();

    // "Supino Reto" (mesmo nome do exercício já publicado, com caixa diferente) força a
    // resolução de colisão de `uniqueExerciseKey`: `supino_reto` já existe → `supino_reto_2`.
    await user.type(within(dialog).getByLabelText('Nome do exercício'), 'Supino Reto');
    expect(salvar).toBeDisabled();

    const peitoCheckbox = within(dialog).getByRole('checkbox', { name: 'peito' });
    await user.click(peitoCheckbox);
    await user.click(peitoCheckbox);
    expect(salvar).toBeDisabled();
    await user.click(peitoCheckbox);
    expect(salvar).toBeDisabled();

    const academiaCheckbox = within(dialog).getByRole('checkbox', { name: 'Academia completa' });
    await user.click(academiaCheckbox);
    expect(salvar).toBeEnabled();

    await user.click(salvar);
    await waitFor(() =>
      expect(publishExerciseCatalogEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          exerciseKey: 'supino_reto_2',
          name: 'Supino Reto',
          muscleGroups: ['peito'],
          locations: ['FULL_GYM'],
          videoUrl: undefined,
          pattern: 'ISOLATION',
          minLevel: 'INICIANTE',
          contraindicatedFor: [],
          substitutes: [],
          equipment: [],
          changeNote: 'Criado pelo painel de Exercícios',
        }),
      ),
    );
    expect(screen.queryByRole('heading', { name: 'Novo exercício' })).not.toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('Exercício criado.');
    expect(getExerciseCatalog).toHaveBeenCalledTimes(2);
  });

  it('cancelar a criação fecha o modal sem publicar nada', async () => {
    const user = userEvent.setup();
    render(<AiExerciseCatalogDashboard canWrite />);
    await screen.findByText('Supino reto');

    await user.click(screen.getByRole('button', { name: 'Novo exercício' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('heading', { name: 'Novo exercício' })).not.toBeInTheDocument();
    expect(publishExerciseCatalogEntry).not.toHaveBeenCalled();
  });

  it('edita um exercício existente, preservando os campos técnicos que o modal não expõe', async () => {
    const user = userEvent.setup();
    render(<AiExerciseCatalogDashboard canWrite />);
    await screen.findByText('Supino reto');

    await user.click(screen.getByRole('button', { name: 'Editar Supino reto' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Editar “Supino reto”' })).toBeVisible();

    const nameInput = within(dialog).getByLabelText('Nome do exercício');
    expect(nameInput).toHaveValue('Supino reto');
    const videoInput = within(dialog).getByLabelText(/Link do vídeo de execução/);
    expect(videoInput).toHaveValue('https://videos.test/supino');
    expect(within(dialog).getByRole('checkbox', { name: 'peito' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Academia completa' })).toBeChecked();

    await user.clear(nameInput);
    await user.type(nameInput, 'Supino reto inclinado');
    await user.clear(videoInput);

    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(publishExerciseCatalogEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          exerciseKey: 'supino_reto',
          name: 'Supino reto inclinado',
          videoUrl: undefined,
          pattern: 'HORIZONTAL_PUSH',
          minLevel: 'INICIANTE',
          contraindicatedFor: ['SHOULDER'],
          substitutes: [],
          equipment: ['barra'],
          changeNote: 'Editado pelo painel de Exercícios',
        }),
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Exercício atualizado.');
  });

  it('falha ao salvar mantém o modal aberto e mostra a mensagem do servidor', async () => {
    publishExerciseCatalogEntry.mockRejectedValueOnce(
      new ControlCenterApiError(409, 'Chave já utilizada por outro exercício.'),
    );
    const user = userEvent.setup();
    render(<AiExerciseCatalogDashboard canWrite />);
    await screen.findByText('Supino reto');

    await user.click(screen.getByRole('button', { name: 'Novo exercício' }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nome do exercício'), 'Prancha isométrica');
    await user.click(within(dialog).getByRole('checkbox', { name: 'core' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Em casa' }));
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Chave já utilizada por outro exercício.',
    );
    expect(within(dialog).getByRole('heading', { name: 'Novo exercício' })).toBeVisible();
  });

  it('exclui um exercício após confirmação destrutiva, atualizando a lista e o aviso', async () => {
    const user = userEvent.setup();
    render(<AiExerciseCatalogDashboard canWrite />);
    await screen.findByText('Supino reto');

    await user.click(screen.getByRole('button', { name: 'Excluir Supino reto' }));
    const confirmDialog = screen.getByRole('dialog');
    expect(
      within(confirmDialog).getByRole('heading', { name: 'Excluir “Supino reto”?' }),
    ).toBeVisible();
    expect(
      within(confirmDialog).getByText(/A IA para de prescrever este exercício em novos protocolos/),
    ).toBeVisible();

    await user.click(within(confirmDialog).getByRole('button', { name: 'Excluir' }));

    await waitFor(() =>
      expect(retireExerciseCatalogEntry).toHaveBeenCalledWith({
        exerciseKey: 'supino_reto',
        changeNote: 'Excluído pelo painel de Exercícios',
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      '“Supino reto” removido do catálogo.',
    );
    expect(getExerciseCatalog).toHaveBeenCalledTimes(2);
  });
});

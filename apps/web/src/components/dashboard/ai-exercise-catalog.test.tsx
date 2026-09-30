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

const {
  getExerciseCatalog,
  publishExerciseCatalogEntry,
  retireExerciseCatalogEntry,
  favoriteExerciseCatalogEntry,
  unfavoriteExerciseCatalogEntry,
} = vi.hoisted(() => ({
  getExerciseCatalog: vi.fn(),
  publishExerciseCatalogEntry: vi.fn(),
  retireExerciseCatalogEntry: vi.fn(),
  favoriteExerciseCatalogEntry: vi.fn(),
  unfavoriteExerciseCatalogEntry: vi.fn(),
}));

vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getExerciseCatalog,
  publishExerciseCatalogEntry,
  retireExerciseCatalogEntry,
  favoriteExerciseCatalogEntry,
  unfavoriteExerciseCatalogEntry,
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
  // Vem do servidor fora da ordem canônica: o modal reordena (Iniciante → Avançado).
  levels: ['AVANCADO', 'INICIANTE'],
  contraindicatedFor: ['SHOULDER'],
  substitutes: [],
  videoUrl: 'https://videos.test/supino',
  version: 3,
  status: 'PUBLISHED',
  changeNote: 'Publicado inicialmente',
  createdBy: 'Rodrigo',
  createdAt: '2026-08-20T12:00:00.000Z',
  current: true,
  isFavorite: false,
};

const agachamento: ExerciseCatalogEntryVersion = {
  id: '22222222-2222-4222-8222-222222222222',
  exerciseKey: 'agachamento_livre',
  name: 'Agachamento livre',
  pattern: 'SQUAT',
  muscleGroups: ['quadríceps', 'glúteo'],
  equipment: [],
  locations: ['FULL_GYM', 'HOME'],
  levels: ['INTERMEDIARIO', 'AVANCADO'],
  contraindicatedFor: [],
  substitutes: [],
  version: 1,
  status: 'PUBLISHED',
  changeNote: 'Publicado inicialmente',
  createdBy: 'Rodrigo',
  createdAt: '2026-08-21T12:00:00.000Z',
  current: true,
  isFavorite: true,
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
  levels: ['INICIANTE'],
  contraindicatedFor: [],
  substitutes: [],
  version: 2,
  status: 'RETIRED',
  changeNote: 'Retirado por duplicidade',
  createdBy: 'Rodrigo',
  createdAt: '2026-08-22T12:00:00.000Z',
  current: true,
  isFavorite: false,
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
  levels: ['INICIANTE'],
  contraindicatedFor: [],
  substitutes: [],
  version: 2,
  status: 'PUBLISHED',
  changeNote: 'Versão anterior',
  createdBy: 'Rodrigo',
  createdAt: '2026-08-19T12:00:00.000Z',
  current: false,
  isFavorite: false,
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
    levels: ['INICIANTE', 'INTERMEDIARIO', 'AVANCADO'],
    contraindicatedFor: [],
    substitutes: [],
    version: 1,
    status: 'PUBLISHED',
    changeNote: 'seed de paginação',
    createdBy: 'Rodrigo',
    createdAt: '2026-08-20T12:00:00.000Z',
    current: true,
    isFavorite: false,
  }));
}

beforeEach(() => {
  getExerciseCatalog.mockReset().mockResolvedValue(response);
  publishExerciseCatalogEntry.mockReset().mockResolvedValue(response);
  retireExerciseCatalogEntry.mockReset().mockResolvedValue(response);
  favoriteExerciseCatalogEntry.mockReset().mockResolvedValue(response);
  unfavoriteExerciseCatalogEntry.mockReset().mockResolvedValue(response);
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
    // Nível também é obrigatório — e a criação começa sem nenhum marcado.
    const nivel = within(dialog).getByRole('group', { name: 'Nível' });
    expect(within(nivel).getByText('Selecione o(s) nível(is)')).toBeInTheDocument();
    for (const option of within(nivel).getAllByRole('checkbox')) expect(option).not.toBeChecked();
    expect(salvar).toBeDisabled();
    // Marcado fora de ordem: o envio sai na ordem canônica.
    await user.click(within(nivel).getByRole('checkbox', { name: 'Avançado' }));
    await user.click(within(nivel).getByRole('checkbox', { name: 'Iniciante' }));
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
          levels: ['INICIANTE', 'AVANCADO'],
          pattern: 'ISOLATION',
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
    // Nível pré-preenchido com `entry.levels`, exibido na ordem canônica.
    const nivel = within(dialog).getByRole('group', { name: 'Nível' });
    expect(within(nivel).getByText('Iniciante, Avançado')).toBeInTheDocument();
    expect(within(nivel).getByRole('checkbox', { name: 'Iniciante' })).toBeChecked();
    expect(within(nivel).getByRole('checkbox', { name: 'Intermediário' })).not.toBeChecked();
    expect(within(nivel).getByRole('checkbox', { name: 'Avançado' })).toBeChecked();
    await user.click(within(nivel).getByRole('checkbox', { name: 'Intermediário' }));

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
          // Intermediário marcado por último, mas enviado no meio: ordem canônica.
          levels: ['INICIANTE', 'INTERMEDIARIO', 'AVANCADO'],
          pattern: 'HORIZONTAL_PUSH',
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
    await user.click(within(dialog).getByRole('checkbox', { name: 'Iniciante' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Em casa' }));
    await user.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Chave já utilizada por outro exercício.',
    );
    expect(within(dialog).getByRole('heading', { name: 'Novo exercício' })).toBeVisible();
  });

  it('combo de Nível lista Iniciante, Intermediário e Avançado nessa ordem', async () => {
    const user = userEvent.setup();
    render(<AiExerciseCatalogDashboard canWrite />);
    await screen.findByText('Supino reto');

    await user.click(screen.getByRole('button', { name: 'Novo exercício' }));
    const nivel = within(screen.getByRole('dialog')).getByRole('group', { name: 'Nível' });
    expect(
      within(nivel)
        .getAllByRole('checkbox')
        .map((box) => box.closest('label')?.textContent),
    ).toEqual(['Iniciante', 'Intermediário', 'Avançado']);
  });

  it('na edição, desmarcar todos os níveis desabilita "Salvar"', async () => {
    const user = userEvent.setup();
    render(<AiExerciseCatalogDashboard canWrite />);
    await screen.findByText('Supino reto');

    await user.click(screen.getByRole('button', { name: 'Editar Supino reto' }));
    const dialog = screen.getByRole('dialog');
    const salvar = within(dialog).getByRole('button', { name: 'Salvar' });
    expect(salvar).toBeEnabled();

    const nivel = within(dialog).getByRole('group', { name: 'Nível' });
    await user.click(within(nivel).getByRole('checkbox', { name: 'Iniciante' }));
    expect(salvar).toBeEnabled();
    await user.click(within(nivel).getByRole('checkbox', { name: 'Avançado' }));
    expect(salvar).toBeDisabled();
    expect(within(nivel).getByText('Selecione o(s) nível(is)')).toBeInTheDocument();

    await user.click(salvar);
    expect(publishExerciseCatalogEntry).not.toHaveBeenCalled();
  });

  it('o combo compartilhado se comporta igual em Músculo e Nível (resumo, marcar, desmarcar)', async () => {
    const user = userEvent.setup();
    render(<AiExerciseCatalogDashboard canWrite />);
    await screen.findByText('Supino reto');

    await user.click(screen.getByRole('button', { name: 'Novo exercício' }));
    const dialog = screen.getByRole('dialog');
    const cases = [
      { group: 'Músculo', placeholder: 'Selecione o(s) músculo(s)', a: 'peito', b: 'costas' },
      { group: 'Nível', placeholder: 'Selecione o(s) nível(is)', a: 'Iniciante', b: 'Avançado' },
    ];
    for (const { group, placeholder, a, b } of cases) {
      const combo = within(dialog).getByRole('group', { name: group });
      const summary = () => combo.querySelector('summary')?.textContent?.replace('▾', '').trim();
      expect(summary()).toBe(placeholder);
      await user.click(within(combo).getByRole('checkbox', { name: a }));
      await user.click(within(combo).getByRole('checkbox', { name: b }));
      expect(summary()).toBe(`${a}, ${b}`);
      await user.click(within(combo).getByRole('checkbox', { name: a }));
      expect(summary()).toBe(b);
      expect(within(combo).getByRole('checkbox', { name: a })).not.toBeChecked();
      expect(within(combo).getByRole('checkbox', { name: b })).toBeChecked();
    }
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

  it('favorita um exercício não favoritado e desfavorita um já favoritado', async () => {
    favoriteExerciseCatalogEntry.mockResolvedValue(
      buildResponse([supinoAntigo, { ...supino, isFavorite: true }, agachamento, flexaoRetirada]),
    );
    unfavoriteExerciseCatalogEntry.mockResolvedValue(
      buildResponse([
        supinoAntigo,
        { ...supino, isFavorite: true },
        { ...agachamento, isFavorite: false },
        flexaoRetirada,
      ]),
    );
    const user = userEvent.setup();
    render(<AiExerciseCatalogDashboard canWrite />);
    await screen.findByText('Supino reto');

    const favoritarSupino = screen.getByRole('button', { name: 'Favoritar Supino reto' });
    expect(favoritarSupino).toHaveAttribute('aria-pressed', 'false');
    const removerAgachamento = screen.getByRole('button', {
      name: 'Remover Agachamento livre dos favoritos',
    });
    expect(removerAgachamento).toHaveAttribute('aria-pressed', 'true');

    await user.click(favoritarSupino);
    await waitFor(() =>
      expect(favoriteExerciseCatalogEntry).toHaveBeenCalledWith({ exerciseKey: 'supino_reto' }),
    );
    expect(unfavoriteExerciseCatalogEntry).not.toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent(
      '“Supino reto” adicionado aos favoritos.',
    );

    await user.click(removerAgachamento);
    await waitFor(() =>
      expect(unfavoriteExerciseCatalogEntry).toHaveBeenCalledWith({
        exerciseKey: 'agachamento_livre',
      }),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      '“Agachamento livre” removido dos favoritos.',
    );
    // A resposta da mutação já é o catálogo: sincroniza sem um segundo GET.
    expect(getExerciseCatalog).toHaveBeenCalledTimes(1);
  });

  it('estrela favoritada é dourada e preenchida (tokens de estado), a não favoritada não', async () => {
    render(<AiExerciseCatalogDashboard canWrite />);
    await screen.findByText('Supino reto');

    const favorita = starIcon('Remover Agachamento livre dos favoritos');
    expect(favorita).toHaveClass('fill-favorite', 'text-favorite-stroke');
    const comum = starIcon('Favoritar Supino reto');
    expect(comum).not.toHaveClass('fill-favorite');
    expect(comum).not.toHaveClass('text-favorite-stroke');
  });

  it('atualização otimista: a estrela acende e o item sobe antes da API responder', async () => {
    const pending = deferred<ExerciseCatalogResponse>();
    favoriteExerciseCatalogEntry.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(<AiExerciseCatalogDashboard canWrite />);
    await screen.findByText('Supino reto');
    expect(listedNames()).toEqual(['Agachamento livre', 'Supino reto']);

    await user.click(screen.getByRole('button', { name: 'Favoritar Supino reto' }));

    // Ainda sem resposta do servidor: estado e posição já refletem o clique.
    const star = screen.getByRole('button', { name: 'Remover Supino reto dos favoritos' });
    expect(star).toHaveAttribute('aria-pressed', 'true');
    expect(star).toBeEnabled();
    expect(starIcon('Remover Supino reto dos favoritos')).toHaveClass('fill-favorite');
    // Os dois são favoritos agora: ordem do catálogo mantida dentro do grupo.
    expect(listedNames()).toEqual(['Supino reto', 'Agachamento livre']);
    // O item reordenado não perde o foco (a linha foi movida no DOM).
    expect(star).toHaveFocus();

    // Clique repetido durante a chamada em voo é ignorado — nada de dupla requisição.
    await user.click(star);
    expect(favoriteExerciseCatalogEntry).toHaveBeenCalledTimes(1);
    expect(unfavoriteExerciseCatalogEntry).not.toHaveBeenCalled();

    pending.resolve(
      buildResponse([supinoAntigo, { ...supino, isFavorite: true }, agachamento, flexaoRetirada]),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      '“Supino reto” adicionado aos favoritos.',
    );
    expect(
      screen.getByRole('button', { name: 'Remover Supino reto dos favoritos' }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('falha ao favoritar reverte a estrela e a posição, e mostra a mensagem do servidor', async () => {
    const pending = deferred<ExerciseCatalogResponse>();
    favoriteExerciseCatalogEntry.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(<AiExerciseCatalogDashboard canWrite />);
    await screen.findByText('Supino reto');

    await user.click(screen.getByRole('button', { name: 'Favoritar Supino reto' }));
    expect(
      screen.getByRole('button', { name: 'Remover Supino reto dos favoritos' }),
    ).toHaveAttribute('aria-pressed', 'true');

    pending.reject(new ControlCenterApiError(400, 'Exercício retirado do catálogo.'));

    expect(await screen.findByRole('status')).toHaveTextContent('Exercício retirado do catálogo.');
    const star = screen.getByRole('button', { name: 'Favoritar Supino reto' });
    expect(star).toHaveAttribute('aria-pressed', 'false');
    expect(starIcon('Favoritar Supino reto')).not.toHaveClass('fill-favorite');
    expect(listedNames()).toEqual(['Agachamento livre', 'Supino reto']);
  });

  it('a resposta do servidor prevalece sobre o estado otimista', async () => {
    // Servidor devolve o catálogo SEM o favorito (ex.: outro RT desfez em paralelo).
    favoriteExerciseCatalogEntry.mockResolvedValue(response);
    const user = userEvent.setup();
    render(<AiExerciseCatalogDashboard canWrite />);
    await screen.findByText('Supino reto');

    await user.click(screen.getByRole('button', { name: 'Favoritar Supino reto' }));
    expect(await screen.findByRole('button', { name: 'Favoritar Supino reto' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('favoritos vêm primeiro no conjunto inteiro, antes de paginar', async () => {
    const versions = manyPublishedVersions(55).map((v) =>
      v.exerciseKey === 'exercicio_52' ? { ...v, isFavorite: true } : v,
    );
    getExerciseCatalog.mockReset().mockResolvedValue(buildResponse(versions));
    const user = userEvent.setup();
    render(<AiExerciseCatalogDashboard canWrite />);
    await screen.findByText('Exercício 00');

    // Pela ordem do catálogo o 52 estaria na página 2; favorito, abre a página 1.
    let names = listedNames();
    expect(names).toHaveLength(50);
    expect(names[0]).toBe('Exercício 52');
    expect(names[1]).toBe('Exercício 00');
    expect(names[49]).toBe('Exercício 48');

    const nav = screen.getByRole('navigation', { name: 'Paginação do catálogo de exercícios' });
    await user.click(within(nav).getByRole('button', { name: 'Próxima página' }));
    names = listedNames();
    expect(names).toEqual([
      'Exercício 49',
      'Exercício 50',
      'Exercício 51',
      'Exercício 53',
      'Exercício 54',
    ]);

    // Favoritar na página 2 sobe o item para a página 1 — a página atual não muda.
    favoriteExerciseCatalogEntry.mockReturnValue(new Promise(() => {}));
    await user.click(screen.getByRole('button', { name: 'Favoritar Exercício 51' }));
    expect(within(nav).getByText('2 / 2')).toBeVisible();
    expect(listedNames()).toEqual([
      'Exercício 48',
      'Exercício 49',
      'Exercício 50',
      'Exercício 53',
      'Exercício 54',
    ]);
    await user.click(within(nav).getByRole('button', { name: 'Página anterior' }));
    expect(listedNames().slice(0, 3)).toEqual(['Exercício 51', 'Exercício 52', 'Exercício 00']);
  });

  describe('filtro de favoritos', () => {
    beforeEach(() => {
      getExerciseCatalog.mockReset().mockResolvedValue(filterResponse);
    });

    it('"Somente favoritos" e "Não favoritos" só valem após "Buscar", com chip e contagem', async () => {
      const user = userEvent.setup();
      render(<AiExerciseCatalogDashboard />);
      await screen.findByText('Supino reto');
      expect(listedNames()).toEqual([
        'Agachamento livre',
        'Remada curvada',
        'Supino reto',
        'Prancha',
      ]);

      await chooseFavorite(user, 'Somente favoritos');
      // Rascunho: nada muda até "Buscar".
      expect(listedNames()).toHaveLength(4);
      await user.click(screen.getByRole('button', { name: 'Buscar' }));
      expect(listedNames()).toEqual(['Agachamento livre', 'Remada curvada']);
      expect(screen.getByText('Favoritos: somente favoritos')).toBeVisible();
      expect(countText()).toBe('2 exercício(s) encontrado(s) para o filtro aplicado.');

      await chooseFavorite(user, 'Não favoritos');
      await user.click(screen.getByRole('button', { name: 'Buscar' }));
      expect(listedNames()).toEqual(['Supino reto', 'Prancha']);
      expect(screen.getByText('Favoritos: não favoritos')).toBeVisible();

      await chooseFavorite(user, 'Todos');
      await user.click(screen.getByRole('button', { name: 'Buscar' }));
      expect(listedNames()).toHaveLength(4);
      expect(screen.queryByText(/^Favoritos:/)).not.toBeInTheDocument();
      expect(countText()).toBe('4 exercício(s) cadastrado(s) no total.');
    });

    it('combina (AND) com Nome, Músculo e Local', async () => {
      const user = userEvent.setup();
      render(<AiExerciseCatalogDashboard />);
      await screen.findByText('Supino reto');

      // Favoritos + Local "Em casa": só o agachamento (a remada é de academia).
      await chooseFavorite(user, 'Somente favoritos');
      await user.click(screen.getByRole('checkbox', { name: 'Em casa' }));
      await user.click(screen.getByRole('button', { name: 'Buscar' }));
      expect(listedNames()).toEqual(['Agachamento livre']);

      // Troca Local por Músculo "costas": só a remada.
      await user.click(screen.getByRole('button', { name: 'Remover filtro Local' }));
      await user.click(screen.getByRole('checkbox', { name: 'costas' }));
      await user.click(screen.getByRole('button', { name: 'Buscar' }));
      expect(listedNames()).toEqual(['Remada curvada']);

      // Não favoritos + Músculo "costas": vazio — a remada é favorita.
      await chooseFavorite(user, 'Não favoritos');
      await user.click(screen.getByRole('button', { name: 'Buscar' }));
      expect(screen.getByText('Nenhum exercício encontrado.')).toBeVisible();
      expect(countText()).toBe('0 exercício(s) encontrado(s) para o filtro aplicado.');

      // Não favoritos + Nome "pran": só a prancha.
      await user.click(screen.getByRole('button', { name: 'Remover filtro Músculo' }));
      await user.type(screen.getByPlaceholderText('Nome do exercício'), 'pran');
      await user.click(screen.getByRole('button', { name: 'Buscar' }));
      expect(listedNames()).toEqual(['Prancha']);
      expect(screen.getByText('Nome: "pran"')).toBeVisible();
      expect(screen.getByText('Favoritos: não favoritos')).toBeVisible();
    });

    it('remover o chip ou "Limpar filtro" desfaz também o filtro de favoritos', async () => {
      const user = userEvent.setup();
      render(<AiExerciseCatalogDashboard />);
      await screen.findByText('Supino reto');

      await chooseFavorite(user, 'Somente favoritos');
      await user.click(screen.getByRole('button', { name: 'Buscar' }));
      expect(listedNames()).toHaveLength(2);

      await user.click(screen.getByRole('button', { name: 'Remover filtro Favoritos' }));
      expect(listedNames()).toHaveLength(4);
      expect(favoriteSelect()).toHaveTextContent('Todos');

      await chooseFavorite(user, 'Não favoritos');
      await user.type(screen.getByPlaceholderText('Nome do exercício'), 'supino');
      await user.click(screen.getByRole('button', { name: 'Buscar' }));
      expect(listedNames()).toEqual(['Supino reto']);

      await user.click(screen.getByRole('button', { name: 'Limpar filtro' }));
      expect(listedNames()).toHaveLength(4);
      expect(favoriteSelect()).toHaveTextContent('Todos');
      expect(screen.getByPlaceholderText('Nome do exercício')).toHaveValue('');
      expect(screen.queryByText(/^Favoritos:/)).not.toBeInTheDocument();
    });

    it('nova busca por favoritos volta para a página 1', async () => {
      const versions = manyPublishedVersions(55).map((v, index) =>
        index % 2 === 0 ? v : { ...v, isFavorite: true },
      );
      getExerciseCatalog.mockReset().mockResolvedValue(buildResponse(versions));
      const user = userEvent.setup();
      render(<AiExerciseCatalogDashboard />);
      await screen.findByText('Exercício 00');

      const nav = screen.getByRole('navigation', {
        name: 'Paginação do catálogo de exercícios',
      });
      await user.click(within(nav).getByRole('button', { name: 'Próxima página' }));
      expect(within(nav).getByText('2 / 2')).toBeVisible();

      await chooseFavorite(user, 'Não favoritos');
      await user.click(screen.getByRole('button', { name: 'Buscar' }));
      // 28 não favoritos (índices pares) cabem numa página só: sem paginação, página 1.
      expect(listedNames()).toHaveLength(28);
      expect(listedNames()[0]).toBe('Exercício 00');
      expect(
        screen.queryByRole('navigation', { name: 'Paginação do catálogo de exercícios' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('filtro de nível', () => {
    beforeEach(() => {
      getExerciseCatalog.mockReset().mockResolvedValue(filterResponse);
    });

    it('um nível só vale após "Buscar", com chip, contagem e remoção pelo chip', async () => {
      const user = userEvent.setup();
      render(<AiExerciseCatalogDashboard />);
      await screen.findByText('Supino reto');

      await user.click(levelOption('Iniciante'));
      expect(listedNames()).toHaveLength(4);
      await user.click(screen.getByRole('button', { name: 'Buscar' }));
      expect(listedNames()).toEqual(['Supino reto', 'Prancha']);
      expect(screen.getByText('Nível: Iniciante')).toBeVisible();
      expect(countText()).toBe('2 exercício(s) encontrado(s) para o filtro aplicado.');

      // Remover o chip limpa rascunho e aplicado de uma vez.
      await user.click(screen.getByRole('button', { name: 'Remover filtro Nível' }));
      expect(listedNames()).toHaveLength(4);
      expect(levelOption('Iniciante')).not.toBeChecked();
      expect(screen.queryByText(/^Nível:/)).not.toBeInTheDocument();
      expect(countText()).toBe('4 exercício(s) cadastrado(s) no total.');
    });

    it('vários níveis combinam por OU, e o chip sai na ordem canônica', async () => {
      const user = userEvent.setup();
      render(<AiExerciseCatalogDashboard />);
      await screen.findByText('Supino reto');

      await user.click(levelOption('Avançado'));
      await user.click(levelOption('Intermediário'));
      await user.click(screen.getByRole('button', { name: 'Buscar' }));
      expect(listedNames()).toEqual(['Agachamento livre', 'Remada curvada', 'Supino reto']);
      expect(screen.getByText('Nível: Intermediário, Avançado')).toBeVisible();
    });

    it('conjunto não contíguo: [Iniciante, Avançado] aparece em Iniciante e em Avançado, não em Intermediário', async () => {
      const user = userEvent.setup();
      render(<AiExerciseCatalogDashboard />);
      await screen.findByText('Supino reto');

      const only = async (level: string) => {
        for (const label of ['Iniciante', 'Intermediário', 'Avançado']) {
          if (levelOption(label).checked !== (label === level))
            await user.click(levelOption(label));
        }
        await user.click(screen.getByRole('button', { name: 'Buscar' }));
        return listedNames();
      };
      expect(await only('Iniciante')).toContain('Supino reto');
      expect(await only('Avançado')).toContain('Supino reto');
      expect(await only('Intermediário')).toEqual(['Agachamento livre', 'Remada curvada']);
    });

    it('combina (AND) com Nome, Músculo, Local e Favoritos', async () => {
      const user = userEvent.setup();
      render(<AiExerciseCatalogDashboard />);
      await screen.findByText('Supino reto');

      // Avançado + Local "Em casa": só o agachamento (o supino é de academia).
      await user.click(levelOption('Avançado'));
      await user.click(screen.getByRole('checkbox', { name: 'Em casa' }));
      await user.click(screen.getByRole('button', { name: 'Buscar' }));
      expect(listedNames()).toEqual(['Agachamento livre']);
      await user.click(screen.getByRole('button', { name: 'Remover filtro Local' }));

      // Avançado + "Não favoritos": só o supino.
      await chooseFavorite(user, 'Não favoritos');
      await user.click(screen.getByRole('button', { name: 'Buscar' }));
      expect(listedNames()).toEqual(['Supino reto']);

      // Troca para Iniciante + Músculo "core" (+ não favoritos): só a prancha.
      await user.click(levelOption('Avançado'));
      await user.click(levelOption('Iniciante'));
      await user.click(screen.getByRole('checkbox', { name: 'core' }));
      await user.click(screen.getByRole('button', { name: 'Buscar' }));
      expect(listedNames()).toEqual(['Prancha']);
      await user.click(screen.getByRole('button', { name: 'Remover filtro Músculo' }));

      // Iniciante + Nome "sup" (+ não favoritos): só o supino.
      await user.type(screen.getByPlaceholderText('Nome do exercício'), 'sup');
      await user.click(screen.getByRole('button', { name: 'Buscar' }));
      expect(listedNames()).toEqual(['Supino reto']);
      expect(screen.getByText('Nível: Iniciante')).toBeVisible();
      expect(screen.getByText('Nome: "sup"')).toBeVisible();
      expect(screen.getByText('Favoritos: não favoritos')).toBeVisible();

      // Intermediário + "Somente favoritos": agachamento e remada; com "Não favoritos": vazio.
      await user.click(screen.getByRole('button', { name: 'Limpar filtro' }));
      await user.click(levelOption('Intermediário'));
      await chooseFavorite(user, 'Somente favoritos');
      await user.click(screen.getByRole('button', { name: 'Buscar' }));
      expect(listedNames()).toEqual(['Agachamento livre', 'Remada curvada']);
      await chooseFavorite(user, 'Não favoritos');
      await user.click(screen.getByRole('button', { name: 'Buscar' }));
      expect(screen.getByText('Nenhum exercício encontrado.')).toBeVisible();
      expect(countText()).toBe('0 exercício(s) encontrado(s) para o filtro aplicado.');
    });

    it('"Limpar filtro" desfaz também o nível', async () => {
      const user = userEvent.setup();
      render(<AiExerciseCatalogDashboard />);
      await screen.findByText('Supino reto');

      await user.click(levelOption('Intermediário'));
      await user.type(screen.getByPlaceholderText('Nome do exercício'), 'remada');
      await user.click(screen.getByRole('button', { name: 'Buscar' }));
      expect(listedNames()).toEqual(['Remada curvada']);

      await user.click(screen.getByRole('button', { name: 'Limpar filtro' }));
      expect(listedNames()).toHaveLength(4);
      expect(levelOption('Intermediário')).not.toBeChecked();
      expect(screen.queryByText(/^Nível:/)).not.toBeInTheDocument();
    });

    it('nova busca por nível volta para a página 1, mantendo favoritos primeiro', async () => {
      const versions = manyPublishedVersions(55).map((v, index): ExerciseCatalogEntryVersion => ({
        ...v,
        levels: [index % 5 === 0 ? 'AVANCADO' : 'INICIANTE'],
        isFavorite: index === 50,
      }));
      getExerciseCatalog.mockReset().mockResolvedValue(buildResponse(versions));
      const user = userEvent.setup();
      render(<AiExerciseCatalogDashboard />);
      await screen.findByText('Exercício 00');

      const nav = screen.getByRole('navigation', {
        name: 'Paginação do catálogo de exercícios',
      });
      await user.click(within(nav).getByRole('button', { name: 'Próxima página' }));
      expect(within(nav).getByText('2 / 2')).toBeVisible();

      await user.click(levelOption('Avançado'));
      await user.click(screen.getByRole('button', { name: 'Buscar' }));
      // Índices múltiplos de 5 (0…50) = 11 exercícios, uma página só; o favorito 50 abre a lista.
      expect(listedNames()).toHaveLength(11);
      expect(listedNames().slice(0, 2)).toEqual(['Exercício 50', 'Exercício 00']);
      expect(
        screen.queryByRole('navigation', { name: 'Paginação do catálogo de exercícios' }),
      ).not.toBeInTheDocument();
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Auxiliares                                                                 */
/* -------------------------------------------------------------------------- */

const remada: ExerciseCatalogEntryVersion = {
  ...supino,
  id: '55555555-5555-4555-8555-555555555555',
  exerciseKey: 'remada_curvada',
  name: 'Remada curvada',
  pattern: 'HORIZONTAL_PULL',
  muscleGroups: ['costas'],
  locations: ['FULL_GYM'],
  levels: ['INTERMEDIARIO'],
  isFavorite: true,
};

const prancha: ExerciseCatalogEntryVersion = {
  ...supino,
  id: '66666666-6666-4666-8666-666666666666',
  exerciseKey: 'prancha',
  name: 'Prancha',
  pattern: 'ISOLATION',
  muscleGroups: ['core'],
  locations: ['HOME'],
  levels: ['INICIANTE'],
  isFavorite: false,
};

/**
 * Ordem do catálogo: supino, agachamento★, remada★, prancha → na tela, favoritos antes.
 * Níveis: supino [Iniciante, Avançado] (não contíguo), agachamento [Intermediário, Avançado],
 * remada [Intermediário], prancha [Iniciante].
 */
const filterResponse = buildResponse([supino, agachamento, remada, prancha]);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function listedNames(): string[] {
  const list = screen.getByRole('list', { name: 'Catálogo de exercícios' });
  return within(list)
    .getAllByRole('heading', { level: 3 })
    .map((heading) => heading.textContent ?? '');
}

function starIcon(buttonName: string): SVGElement {
  const icon = screen.getByRole('button', { name: buttonName }).querySelector('svg');
  if (!icon) throw new Error(`ícone da estrela não encontrado em "${buttonName}"`);
  return icon;
}

function levelOption(label: string): HTMLInputElement {
  const group = screen.getByRole('group', { name: 'Nível' });
  return within(group).getByRole('checkbox', { name: label }) as HTMLInputElement;
}

function favoriteSelect(): HTMLElement {
  return screen.getByRole('combobox', { name: /Favoritos/ });
}

async function chooseFavorite(user: ReturnType<typeof userEvent.setup>, option: string) {
  await user.click(favoriteSelect());
  await user.click(await screen.findByRole('option', { name: option }));
}

function countText(): string {
  return (
    screen.getByText(/exercício\(s\) (encontrado|cadastrado)/).textContent?.replace(/\s+/g, ' ') ??
    ''
  ).trim();
}

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProtocolReview as Protocol } from '@movivo/shared';

import type * as ControlCenterApi from '@/lib/control-center-api';

const { getExceptionProtocol, saveExceptionProtocol, getActiveProtocol, amendActiveProtocol } =
  vi.hoisted(() => ({
    getExceptionProtocol: vi.fn(),
    saveExceptionProtocol: vi.fn(),
    getActiveProtocol: vi.fn(),
    amendActiveProtocol: vi.fn(),
  }));
vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  getExceptionProtocol,
  saveExceptionProtocol,
  getActiveProtocol,
  amendActiveProtocol,
}));

import { ProtocolEditError } from '@/lib/control-center-api';

import { ProtocolReview } from './protocol-review';

const ID = '11111111-1111-4111-8111-111111111111';
const ENUM = /\b(STRENGTH|RUNNING|DOUBLE_PROGRESSION|PUBLISH_\w+|EVENING|STEADY|KEY)\b/;

const training: Extract<Protocol, { kind: 'TRAINING' }> = {
  kind: 'TRAINING',
  planId: '22222222-2222-4222-8222-222222222222',
  version: 1,
  status: 'DRAFT',
  editable: true,
  startsOn: '2026-11-04',
  strategy: {
    title: 'Força com consistência',
    modalityFocus: ['STRENGTH'],
    energyStrategy: 'MAINTENANCE',
    studentMessage: 'No seu ritmo.',
  },
  structure: {
    summary: 'Duas sessões de força e uma corrida leve por semana.',
    modalityPriorities: [
      { modality: 'STRENGTH', priority: 1 },
      { modality: 'RUNNING', priority: 2 },
    ],
    phases: [{ name: 'Adaptação', focus: 'Técnica.', weeks: 4, endsWithDeload: false }],
    sessions: [
      {
        key: 'FORCA_A',
        title: 'Força A',
        purpose: 'Base de força.',
        priority: 'KEY',
        weeklyFrequency: 1,
        estimatedMinutes: 50,
        estimatedRpe: 7,
        content: {
          modality: 'STRENGTH',
          focus: 'Corpo inteiro',
          exercises: [
            {
              exerciseId: 'agachamento',
              name: 'Agachamento',
              sets: 3,
              reps: { min: 8, max: 10 },
              loadStrategy: 'DOUBLE_PROGRESSION',
              rir: 2,
              restSeconds: 90,
            },
            {
              exerciseId: 'remada',
              name: 'Remada baixa',
              sets: 3,
              reps: { min: 10, max: 12 },
              loadStrategy: 'FIXED_LOAD',
              restSeconds: 60,
            },
          ],
        },
      },
      {
        key: 'CORRIDA_LEVE',
        title: 'Corrida leve',
        purpose: 'Base aeróbia.',
        priority: 'IMPORTANT',
        weeklyFrequency: 1,
        estimatedMinutes: 30,
        estimatedRpe: 4,
        content: {
          modality: 'RUNNING',
          kind: 'EASY',
          terrain: 'ANY',
          segments: [{ type: 'STEADY', durationSeconds: 1800, target: { by: 'ZONE', zone: 'Z2' } }],
        },
      },
    ],
  },
  weekPreview: {
    weekStart: '2026-11-02',
    startsOn: '2026-11-04',
    sessions: [
      {
        date: '2026-11-04',
        slot: 'EVENING',
        sessionKey: 'FORCA_A',
        occurrence: 1,
        title: 'Força A',
        modality: 'STRENGTH',
        priority: 'KEY',
      },
    ],
    dropped: [],
  },
  weekModel: {
    sessions: [
      { weekday: 'WED', slot: 'EVENING', sessionKey: 'FORCA_A', occurrence: 1 },
      { weekday: 'FRI', slot: 'EVENING', sessionKey: 'CORRIDA_LEVE', occurrence: 1 },
    ],
    dropped: [],
  },
  exerciseOptions: [
    {
      id: 'agachamento',
      name: 'Agachamento',
      measurement: 'REPS',
      muscleGroups: ['quadríceps'],
      equipment: ['barra'],
    },
    {
      id: 'leg_press',
      name: 'Leg press',
      measurement: 'REPS',
      muscleGroups: ['quadríceps', 'glúteo'],
      equipment: ['máquina'],
    },
    {
      id: 'prancha',
      name: 'Prancha',
      measurement: 'DURATION',
      muscleGroups: ['core'],
      equipment: [],
    },
    {
      id: 'remada',
      name: 'Remada baixa',
      measurement: 'REPS',
      muscleGroups: ['costas'],
      equipment: ['polia'],
    },
  ],
};

const nutrition: Extract<Protocol, { kind: 'NUTRITION' }> = {
  kind: 'NUTRITION',
  planId: '22222222-2222-4222-8222-222222222222',
  version: 2,
  status: 'DRAFT',
  editable: true,
  startsOn: '2026-11-04',
  strategy: null,
  structure: {
    strategy: 'DEFICIT',
    summary: 'Déficit moderado preservando músculo.',
    trainingDay: {
      energyKcal: { min: 2000, max: 2200 },
      proteinG: 140,
      carbsG: 220,
      fatG: 60,
      fiberG: 30,
      waterMl: 2500,
    },
    restDay: {
      energyKcal: { min: 1800, max: 2000 },
      proteinG: 140,
      carbsG: 180,
      fatG: 60,
      fiberG: 30,
      waterMl: 2500,
    },
    meals: [
      {
        slot: 'BREAKFAST',
        energyShare: 0.5,
        proteinG: 30,
        guidance: 'Proteína logo cedo.',
        examples: ['Ovos com pão'],
        options: [
          {
            title: 'Ovos com pão',
            items: [
              {
                foodId: 'ovo',
                name: 'Ovo',
                grams: 100,
                energyKcal: 143,
                proteinG: 13,
                carbsG: 1,
                fatG: 9,
                swaps: [],
              },
            ],
            totals: { energyKcal: 143, proteinG: 13, carbsG: 1, fatG: 9, fiberG: 0 },
            estimatedCostBrl: 3,
          },
          {
            title: 'Iogurte com fruta',
            items: [
              {
                foodId: 'iogurte',
                name: 'Iogurte natural',
                grams: 170,
                energyKcal: 100,
                proteinG: 7,
                carbsG: 9,
                fatG: 5,
                swaps: [],
              },
            ],
            totals: { energyKcal: 100, proteinG: 7, carbsG: 9, fatG: 5, fiberG: 0 },
            estimatedCostBrl: 4,
          },
        ],
      },
      {
        slot: 'DINNER',
        energyShare: 0.5,
        proteinG: 40,
        guidance: 'Prato completo.',
        examples: ['Arroz, feijão e frango'],
      },
    ],
    guidelines: ['Beba água ao longo do dia.'],
    supplements: [],
  },
  foodOptions: [
    {
      id: 'ovo',
      name: 'Ovo',
      category: 'Ovos',
      energyKcal: 143,
      proteinG: 13,
      carbsG: 1,
      fatG: 9,
    },
    {
      id: 'iogurte',
      name: 'Iogurte natural',
      category: 'Leites e derivados',
      energyKcal: 60,
      proteinG: 4,
      carbsG: 5,
      fatG: 3,
    },
  ],
};

beforeEach(() => {
  getExceptionProtocol.mockReset().mockResolvedValue(training);
  saveExceptionProtocol.mockReset().mockResolvedValue(training);
  getActiveProtocol.mockReset().mockResolvedValue(nutrition);
  amendActiveProtocol.mockReset().mockResolvedValue(undefined);
});

const startEditing = async () =>
  userEvent.click(await screen.findByRole('button', { name: 'Editar' }));

/** A sessão (cabeçalho recolhível) pelo título: o nome do botão começa com ele. */
const sessionToggle = (title: string) =>
  screen.getByRole('button', { name: new RegExp(`^${title}`) });
const openSession = async (title: string) => userEvent.click(sessionToggle(title));

/** O bloco de um dia da semana do protocolo. */
const dayBlock = (name: string) =>
  within(screen.getByRole('list', { name: 'Semana do protocolo' })).getByRole('listitem', { name });
const titlesIn = (name: string) =>
  within(dayBlock(name))
    .queryAllByRole('article')
    .map(
      (article) =>
        document.getElementById(article.getAttribute('aria-labelledby') ?? '')?.textContent,
    );

const exerciseNames = () =>
  within(screen.getByRole('list', { name: 'Exercícios da sessão Força A' }))
    .getAllByRole('listitem')
    .map((item) => item.querySelector('p')?.textContent?.replace(/^\d+/, ''));

describe('ProtocolReview — leitura', () => {
  it('mostra a semana, as sessões em colunas e nada de enum cru', async () => {
    render(<ProtocolReview caseId={ID} canAct onChanged={vi.fn()} />);
    expect(await screen.findByRole('heading', { name: 'Primeira semana' })).toBeInTheDocument();
    const wednesday = screen.getByRole('listitem', { name: 'quarta-feira, 04/11' });
    expect(wednesday).toHaveTextContent('Força A');
    expect(wednesday).toHaveTextContent('noite');
    expect(screen.getByRole('listitem', { name: 'quinta-feira, 05/11' })).toHaveTextContent(
      'Descanso',
    );
    expect(screen.getByRole('listitem', { name: 'segunda-feira, 02/11' })).toHaveTextContent(
      'Antes do início',
    );

    const card = screen.getByRole('article', { name: 'Força A' });
    expect(card).toHaveTextContent('Musculação · Corpo inteiro');
    expect(card).toHaveTextContent('Sessão-chave');
    expect(card).toHaveTextContent('1×/semana · 50 min · PSE 7');
    expect(card).toHaveTextContent(
      /Agachamento.*Séries 3.*Repetições 8–10.*Descanso 1 min 30 s.*Carga RIR 2/,
    );
    expect(card).toHaveTextContent('Carga fixa');
    expect(screen.getByRole('article', { name: 'Corrida leve' })).toHaveTextContent(
      /Contínuo.*30 min.*Zona 2/,
    );
    expect(screen.getByRole('region', { name: 'Plano de treino' }).textContent).not.toMatch(ENUM);
  });

  it('sem poder agir, só lê (sem Ver/Editar)', async () => {
    render(<ProtocolReview caseId={ID} canAct={false} onChanged={vi.fn()} />);
    await screen.findByText(/Duas sessões de força/);
    expect(screen.queryByRole('button', { name: 'Editar' })).toBeNull();
  });

  it('na Fila, agrupa os treinos pelo dia e mantém o conteúdo recolhido', async () => {
    render(<ProtocolReview caseId={ID} canAct queuePresentation onChanged={vi.fn()} />);
    expect(await screen.findByText('versão 1')).toBeVisible();
    const wednesday = screen.getByRole('button', { name: /quarta-feira/i });
    expect(wednesday).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Agachamento')).toBeNull();
    expect(screen.getByRole('button', { name: /Outras sessões do protocolo/i })).toHaveTextContent(
      '1 sem horário nesta semana',
    );
    await userEvent.click(wednesday);
    expect(await screen.findByText('Agachamento')).toBeVisible();
    expect(screen.getByText('Observações do protocolo')).toBeVisible();
  });

  it('esqueleto ao carregar e "Tentar novamente" no erro', async () => {
    getExceptionProtocol.mockReset().mockRejectedValueOnce(new Error('Falhou a rede.'));
    getExceptionProtocol.mockResolvedValueOnce(training);
    render(<ProtocolReview caseId={ID} canAct onChanged={vi.fn()} />);
    expect(screen.getByRole('status', { name: 'Carregando o protocolo' })).toBeInTheDocument();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Falhou a rede.');
    await userEvent.click(within(alert).getByRole('button', { name: /Tentar novamente/ }));
    expect(await screen.findByText(/Duas sessões de força/)).toBeInTheDocument();
  });
});

describe('ProtocolReview — edição do treino', () => {
  it('alterna Ver/Editar e sinaliza alterações não salvas', async () => {
    const onStateChange = vi.fn();
    render(<ProtocolReview caseId={ID} canAct onChanged={vi.fn()} onStateChange={onStateChange} />);
    await startEditing();
    expect(screen.getByRole('button', { name: 'Editar' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Nenhuma alteração ainda')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar edição' })).toBeDisabled();

    await openSession('Força A');
    const sets = screen.getByLabelText('Séries de Agachamento');
    await userEvent.clear(sets);
    await userEvent.type(sets, '4');
    expect(screen.getByText('Alterações não salvas')).toBeInTheDocument();
    expect(onStateChange).toHaveBeenLastCalledWith({ editing: true, dirty: true });

    // Voltar para "Ver" com alterações pede confirmação.
    await userEvent.click(screen.getByRole('button', { name: 'Ver' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Descartar alterações' }));
    expect(screen.queryByText('Alterações não salvas')).toBeNull();
    expect(onStateChange).toHaveBeenLastCalledWith({ editing: false, dirty: false });
  });

  it('a semana vem por dia, com as sessões recolhidas no dia certo e descanso nos demais', async () => {
    render(<ProtocolReview caseId={ID} canAct onChanged={vi.fn()} />);
    await startEditing();
    const days = within(screen.getByRole('list', { name: 'Semana do protocolo' })).getAllByRole(
      'listitem',
      { name: /-feira|Sábado|Domingo/ },
    );
    expect(days.map((day) => day.getAttribute('aria-label'))).toEqual([
      'Segunda-feira',
      'Terça-feira',
      'Quarta-feira',
      'Quinta-feira',
      'Sexta-feira',
      'Sábado',
      'Domingo',
    ]);
    expect(titlesIn('Quarta-feira')).toEqual(['Força A']);
    expect(titlesIn('Sexta-feira')).toEqual(['Corrida leve']);
    for (const idle of ['Segunda-feira', 'Terça-feira', 'Quinta-feira', 'Sábado', 'Domingo']) {
      expect(dayBlock(idle)).toHaveTextContent('Descanso');
    }
    for (const title of ['Força A', 'Corrida leve']) {
      expect(sessionToggle(title)).toHaveAttribute('aria-expanded', 'false');
    }
    expect(sessionToggle('Força A')).toHaveTextContent('Corpo inteiro · 2 exercícios');
    expect(sessionToggle('Força A')).toHaveTextContent('1×/semana · 50 min · PSE 7');
    expect(screen.queryByLabelText('Título da sessão A')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Exercícios da sessão Força A' })).toBeNull();
    expect(screen.queryByText('Sem dia definido')).toBeNull();

    await openSession('Força A');
    expect(sessionToggle('Força A')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Título da sessão A')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Dia da semana de Força A' })).toHaveValue('WED');
    expect(exerciseNames()).toEqual(['Agachamento', 'Remada baixa']);
    expect(screen.queryByRole('list', { name: 'Exercícios da sessão Corrida leve' })).toBeNull();
    await openSession('Força A');
    expect(sessionToggle('Força A')).toHaveAttribute('aria-expanded', 'false');
  });

  it('mover para o dia anterior ou seguinte leva a sessão de bloco, anuncia e a mantém aberta', async () => {
    render(<ProtocolReview caseId={ID} canAct onChanged={vi.fn()} />);
    await startEditing();
    await openSession('Corrida leve');
    await userEvent.click(
      screen.getByRole('button', { name: 'Mover sessão Corrida leve para o próximo dia' }),
    );
    expect(titlesIn('Sexta-feira')).toEqual([]);
    expect(titlesIn('Sábado')).toEqual(['Corrida leve']);
    expect(screen.getByText('Sessão Corrida leve movida para Sábado.')).toBeInTheDocument();
    expect(sessionToggle('Corrida leve')).toHaveAttribute('aria-expanded', 'true');
    // O foco acompanha o botão depois que o cartão muda de bloco.
    expect(
      screen.getByRole('button', { name: 'Mover sessão Corrida leve para o próximo dia' }),
    ).toHaveFocus();
    expect(screen.getByText('Alterações não salvas')).toBeInTheDocument();
    // Quem não foi tocado continua no mesmo dia.
    expect(titlesIn('Quarta-feira')).toEqual(['Força A']);

    await userEvent.click(
      screen.getByRole('button', { name: 'Mover sessão Corrida leve para o dia anterior' }),
    );
    expect(titlesIn('Sexta-feira')).toEqual(['Corrida leve']);
  });

  it('os limites da semana: segunda não sobe e domingo não desce', async () => {
    render(<ProtocolReview caseId={ID} canAct onChanged={vi.fn()} />);
    await startEditing();
    const earlier = () =>
      screen.getByRole('button', { name: 'Mover sessão Força A para o dia anterior' });
    expect(earlier()).toBeEnabled();
    await userEvent.click(earlier());
    await userEvent.click(earlier());
    expect(titlesIn('Segunda-feira')).toEqual(['Força A']);
    expect(
      screen.getByRole('button', { name: 'Mover sessão Força A para o dia anterior' }),
    ).toBeDisabled();
  });

  it('escolher o dia dentro da sessão move para ele', async () => {
    render(<ProtocolReview caseId={ID} canAct onChanged={vi.fn()} />);
    await startEditing();
    await openSession('Força A');
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Dia da semana de Força A' }),
      'SUN',
    );
    expect(titlesIn('Domingo')).toEqual(['Força A']);
    expect(titlesIn('Quarta-feira')).toEqual([]);
  });

  it('arrastar sobre outro dia move; sobre outra sessão troca os dias', async () => {
    render(<ProtocolReview caseId={ID} canAct onChanged={vi.fn()} />);
    await startEditing();
    const data = { setData: vi.fn(), getData: () => '', effectAllowed: '', dropEffect: '' };
    const grip = (name: string) =>
      screen.getByRole('button', { name: `Arrastar sessão ${name} para outro dia` });

    fireEvent.dragStart(grip('Força A'), { dataTransfer: data });
    fireEvent.dragOver(dayBlock('Terça-feira'), { dataTransfer: data });
    fireEvent.drop(dayBlock('Terça-feira'), { dataTransfer: data });
    expect(titlesIn('Terça-feira')).toEqual(['Força A']);
    expect(titlesIn('Quarta-feira')).toEqual([]);

    const corrida = within(dayBlock('Sexta-feira')).getAllByRole('article')[0] as HTMLElement;
    fireEvent.dragStart(grip('Força A'), { dataTransfer: data });
    fireEvent.dragOver(corrida, { dataTransfer: data });
    fireEvent.drop(corrida, { dataTransfer: data });
    expect(titlesIn('Terça-feira')).toEqual(['Corrida leve']);
    expect(titlesIn('Sexta-feira')).toEqual(['Força A']);
    expect(screen.getByText('Sessões Força A e Corrida leve trocaram de dia.')).toBeInTheDocument();
  });

  it('uma sessão que se repete na semana aparece em cada dia e a edição vale para todas', async () => {
    render(<ProtocolReview caseId={ID} canAct onChanged={vi.fn()} />);
    await startEditing();
    await openSession('Força A');
    const times = screen.getByLabelText('Vezes por semana da sessão Força A');
    await userEvent.clear(times);
    await userEvent.type(times, '2');
    // A segunda vez ainda não tem dia: fica à vista, em "Sem dia definido".
    const unplaced = screen.getByRole('region', { name: 'Sessões sem dia definido' });
    expect(within(unplaced).getAllByRole('article')).toHaveLength(1);
    expect(unplaced).toHaveTextContent('Força A');
    await userEvent.click(within(unplaced).getByRole('button', { name: /^Força A/ }));
    expect(screen.getAllByText(/Vez [12] de 2 na semana/)).toHaveLength(2);

    await userEvent.selectOptions(
      within(unplaced).getByRole('combobox', { name: 'Dia da semana de Força A' }),
      'MON',
    );
    expect(titlesIn('Segunda-feira')).toEqual(['Força A']);
    expect(titlesIn('Quarta-feira')).toEqual(['Força A']);
    expect(screen.queryByRole('region', { name: 'Sessões sem dia definido' })).toBeNull();

    // Sem repetir a mesma sessão no mesmo dia: da segunda vai para a terça, mas não para a quarta.
    const next = () =>
      screen.getAllByRole('button', {
        name: 'Mover sessão Força A para o próximo dia',
      })[0] as HTMLElement;
    await userEvent.click(next());
    expect(titlesIn('Terça-feira')).toEqual(['Força A']);
    await userEvent.click(next());
    expect(screen.getByText(/já está na Quarta-feira/)).toBeInTheDocument();
    expect(titlesIn('Terça-feira')).toEqual(['Força A']);
  });

  it('salvar envia o dia de cada sessão no protocolo', async () => {
    saveExceptionProtocol.mockResolvedValue(training);
    render(<ProtocolReview caseId={ID} canAct onChanged={vi.fn().mockResolvedValue(undefined)} />);
    await startEditing();
    await userEvent.click(
      screen.getByRole('button', { name: 'Mover sessão Corrida leve para o próximo dia' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Salvar edição' }));
    await waitFor(() => expect(saveExceptionProtocol).toHaveBeenCalledOnce());
    const [, body] = saveExceptionProtocol.mock.calls[0] ?? [];
    const sessions = body.structure.sessions as { key: string; weekdays?: string[] }[];
    expect(sessions.find((x) => x.key === 'FORCA_A')?.weekdays).toEqual(['WED']);
    expect(sessions.find((x) => x.key === 'CORRIDA_LEVE')?.weekdays).toEqual(['SAT']);
  });

  it('uma sessão nova vem aberta para ser ajustada; as outras seguem recolhidas', async () => {
    render(<ProtocolReview caseId={ID} canAct onChanged={vi.fn()} />);
    await startEditing();
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar sessão de musculação' }));
    const dialog = await screen.findByRole('dialog', { name: 'Primeiro exercício da nova sessão' });
    await userEvent.click(within(dialog).getByRole('button', { name: /Leg press/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // A sessão nova (resumo "Novo treino") abre; a original continua recolhida.
    const created = screen.getByRole('button', { name: /Novo treino/ });
    expect(created).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Corpo inteiro/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByRole('button', { name: /Rodagem leve/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getAllByRole('list', { name: /^Exercícios da sessão/ })).toHaveLength(1);
  });

  it('reordena exercícios com ↑/↓, anuncia e mantém o foco no item movido', async () => {
    render(<ProtocolReview caseId={ID} canAct onChanged={vi.fn()} />);
    await startEditing();
    await openSession('Força A');
    expect(exerciseNames()).toEqual(['Agachamento', 'Remada baixa']);
    const down = screen.getByRole('button', { name: 'Descer Agachamento' });
    await userEvent.click(down);
    expect(exerciseNames()).toEqual(['Remada baixa', 'Agachamento']);
    expect(screen.getByText('Agachamento movido para a posição 2 de 2.')).toBeInTheDocument();
    // No fim da lista o ↓ desabilita e o foco passa para o ↑ do mesmo exercício.
    expect(screen.getByRole('button', { name: 'Descer Agachamento' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Subir Agachamento' })).toHaveFocus();
  });

  it('reordena pelo teclado na alça e arrastando', async () => {
    render(<ProtocolReview caseId={ID} canAct onChanged={vi.fn()} />);
    await startEditing();
    await openSession('Força A');
    const grip = screen.getByRole('button', { name: /Reordenar Remada baixa \(posição 2 de 2\)/ });
    grip.focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(exerciseNames()).toEqual(['Remada baixa', 'Agachamento']);
    expect(screen.getByRole('button', { name: /Reordenar Remada baixa/ })).toHaveFocus();

    // Arrastar: pressionar a alça arma a linha; soltar sobre a outra move para lá.
    const rows = within(
      screen.getByRole('list', { name: 'Exercícios da sessão Força A' }),
    ).getAllByRole('listitem');
    fireEvent.pointerDown(screen.getByRole('button', { name: /Reordenar Agachamento/ }));
    const data = { setData: vi.fn(), getData: () => '1', effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(rows[1] as HTMLElement, { dataTransfer: data });
    fireEvent.dragOver(rows[0] as HTMLElement, { dataTransfer: data });
    fireEvent.drop(rows[0] as HTMLElement, { dataTransfer: data });
    expect(exerciseNames()).toEqual(['Agachamento', 'Remada baixa']);
  });

  it('adiciona do catálogo com busca e filtros (sem texto livre) e salva', async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(<ProtocolReview caseId={ID} canAct onChanged={onChanged} />);
    await startEditing();
    await openSession('Força A');
    await userEvent.click(screen.getByRole('button', { name: 'Adicionar exercício do catálogo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Adicionar exercício' });
    // Quem já está na sessão aparece, mas desabilitado.
    expect(within(dialog).getByRole('button', { name: /Agachamento/ })).toBeDisabled();
    await userEvent.selectOptions(within(dialog).getByLabelText('Grupo muscular'), 'core');
    expect(within(dialog).getByRole('status')).toHaveTextContent('1 exercício');
    await userEvent.selectOptions(within(dialog).getByLabelText('Equipamento'), 'Peso do corpo');
    await userEvent.type(within(dialog).getByLabelText('Buscar'), 'pranch');
    await userEvent.click(within(dialog).getByRole('button', { name: /Prancha/ }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(exerciseNames()).toEqual(['Agachamento', 'Remada baixa', 'Prancha']);
    // Por tempo: o campo vira "Tempo (s)".
    expect(screen.getByLabelText('Tempo em segundos de Prancha')).toHaveValue(30);

    await userEvent.click(screen.getByRole('button', { name: 'Remover Remada baixa' }));
    expect(exerciseNames()).toEqual(['Agachamento', 'Prancha']);

    await userEvent.click(screen.getByRole('button', { name: 'Salvar edição' }));
    await waitFor(() => expect(saveExceptionProtocol).toHaveBeenCalledOnce());
    const [caseId, body] = saveExceptionProtocol.mock.calls[0] ?? [];
    expect(caseId).toBe(ID);
    expect(body.kind).toBe('TRAINING');
    expect(
      body.structure.sessions[0].content.exercises.map((e: { exerciseId: string }) => e.exerciseId),
    ).toEqual(['agachamento', 'prancha']);
    expect(onChanged).toHaveBeenCalled();
    expect(await screen.findByText('Edição salva e conferida pelo servidor.')).toBeInTheDocument();
  });

  it('troca o exercício pelo catálogo', async () => {
    render(<ProtocolReview caseId={ID} canAct onChanged={vi.fn()} />);
    await startEditing();
    await openSession('Força A');
    await userEvent.click(screen.getByRole('button', { name: 'Trocar Agachamento' }));
    const dialog = await screen.findByRole('dialog', { name: 'Trocar exercício' });
    await userEvent.click(within(dialog).getByRole('button', { name: /Leg press/ }));
    expect(exerciseNames()).toEqual(['Leg press', 'Remada baixa']);
    expect(screen.getByLabelText('Séries de Leg press')).toHaveValue(3);
  });

  it('mostra cada problema do servidor no resumo e na linha do exercício', async () => {
    saveExceptionProtocol.mockRejectedValue(
      new ProtocolEditError(
        400,
        'O protocolo editado não passou na conferência.',
        [
          'Exercício contraindicado para o joelho do aluno',
          '3 sessões por semana passam do limite',
        ],
        [
          {
            path: ['sessions', 0, 'content', 'exercises', 0, 'exerciseId'],
            message: 'Exercício contraindicado para o joelho do aluno',
          },
          { path: ['sessions'], message: '3 sessões por semana passam do limite' },
        ],
      ),
    );
    render(<ProtocolReview caseId={ID} canAct onChanged={vi.fn()} />);
    await startEditing();
    await openSession('Força A');
    await userEvent.clear(screen.getByLabelText('Duração em minutos da sessão Força A'));
    await userEvent.type(screen.getByLabelText('Duração em minutos da sessão Força A'), '55');
    // Recolhida, a sessão com problema se abre sozinha ao voltar o erro do servidor.
    await openSession('Força A');
    expect(screen.queryByLabelText('Séries de Agachamento')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Salvar edição' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('(2 pontos)');
    expect(sessionToggle('Força A')).toHaveAttribute('aria-expanded', 'true');
    expect(alert).toHaveTextContent('Força A · Agachamento: Exercício contraindicado');
    const row = screen.getByLabelText('Séries de Agachamento').closest('[aria-invalid="true"]');
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent('Exercício contraindicado para o joelho do aluno');
  });

  it('erro de servidor sem caminho (formato antigo) aparece no resumo', async () => {
    saveExceptionProtocol.mockRejectedValue(
      new ProtocolEditError(400, 'x', ['3 sessões por semana passam do que o aluno sustenta (2)']),
    );
    render(<ProtocolReview caseId={ID} canAct onChanged={vi.fn()} />);
    await startEditing();
    await openSession('Força A');
    await userEvent.clear(screen.getByLabelText('Duração em minutos da sessão Força A'));
    await userEvent.type(screen.getByLabelText('Duração em minutos da sessão Força A'), '55');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar edição' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/passam do que o aluno sustenta/);
  });

  it('confere localmente antes de enviar (mensagem em português)', async () => {
    render(<ProtocolReview caseId={ID} canAct onChanged={vi.fn()} />);
    await startEditing();
    await openSession('Força A');
    await userEvent.clear(screen.getByLabelText('Título da sessão A'));
    await userEvent.click(screen.getByRole('button', { name: 'Salvar edição' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sessão A: Preencha este campo.');
    expect(saveExceptionProtocol).not.toHaveBeenCalled();
  });
});

describe('ProtocolReview — plano alimentar (emenda)', () => {
  it('metas na mesma grade, opções A/B por abas e orientações sob demanda', async () => {
    render(
      <ProtocolReview
        amend={{ studentId: 'aluno', kind: 'NUTRITION' }}
        canAct
        onChanged={vi.fn()}
      />,
    );
    const training = await screen.findByRole('region', { name: 'Dia de treino' });
    expect(training).toHaveTextContent('Caloria2000–2200 kcal');
    expect(training).toHaveTextContent('Água2,5 L');
    expect(screen.getByText('Déficit calórico')).toBeInTheDocument();

    const breakfast = screen.getByRole('article', { name: 'Café da manhã' });
    expect(breakfast).toHaveTextContent('50% das calorias · 30 g de proteína');
    expect(within(breakfast).getByRole('tab', { name: 'Opção A' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(breakfast).toHaveTextContent('Ovo');
    await userEvent.click(within(breakfast).getByRole('tab', { name: 'Opção B' }));
    expect(breakfast).toHaveTextContent('Iogurte natural');

    const guidelines = screen.getByRole('button', { name: /Orientações/ });
    expect(guidelines).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Beba água ao longo do dia.')).toBeNull();
    await userEvent.click(guidelines);
    expect(screen.getByText('Beba água ao longo do dia.')).toBeInTheDocument();
  });

  it('mostra o nome do alimento como se fala, mesmo com o nome da TACO salvo no plano', async () => {
    const withTacoNames = structuredClone(nutrition);
    const firstMeal = withTacoNames.structure.meals[0];
    const item = firstMeal?.options?.[0]?.items[0];
    if (!item) throw new Error('fixture sem item');
    item.name = 'Ovo, de galinha, inteiro, cozido';
    item.swaps = [
      {
        foodId: 'pao',
        name: 'Pão, trigo, francês',
        grams: 50,
        energyKcal: 150,
      },
    ];
    getActiveProtocol.mockResolvedValue(withTacoNames);
    render(
      <ProtocolReview
        amend={{ studentId: 'aluno', kind: 'NUTRITION' }}
        canAct
        onChanged={vi.fn()}
      />,
    );
    const breakfast = await screen.findByRole('article', { name: 'Café da manhã' });
    expect(breakfast).toHaveTextContent('Ovo de galinha cozido');
    expect(breakfast).toHaveTextContent('Pão francês');
    expect(breakfast.textContent).not.toMatch(/Ovo, de galinha|Pão, trigo/);
  });

  it('edita a porção e salva a emenda', async () => {
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(
      <ProtocolReview
        amend={{ studentId: 'aluno', kind: 'NUTRITION' }}
        canAct
        onChanged={onChanged}
      />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Emendar' }));
    const grams = screen.getByLabelText('Quantidade em gramas de Ovo');
    await userEvent.clear(grams);
    await userEvent.type(grams, '150');
    expect(screen.getByText(/ao salvar, vira a versão 3/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Salvar edição' }));
    await waitFor(() => expect(amendActiveProtocol).toHaveBeenCalledOnce());
    const [studentId, body] = amendActiveProtocol.mock.calls[0] ?? [];
    expect(studentId).toBe('aluno');
    expect(body.structure.meals[0].options[0].items[0].grams).toBe(150);
  });

  it('na Fila, recolhe as refeições e mantém metas e observações no mesmo estilo', async () => {
    render(
      <ProtocolReview
        amend={{ studentId: 'aluno', kind: 'NUTRITION' }}
        canAct
        queuePresentation
        onChanged={vi.fn()}
      />,
    );
    const breakfast = await screen.findByRole('button', { name: /Café da manhã/ });
    expect(breakfast).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('tab', { name: 'Opção A' })).toBeNull();
    await userEvent.click(breakfast);
    expect(await screen.findByRole('tab', { name: 'Opção A' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Metas do dia/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByText('Observações do protocolo')).toBeVisible();
  });
});

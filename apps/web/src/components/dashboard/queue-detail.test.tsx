import type { ParqQuestionId } from '@movivo/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  anamnesisAnswers,
  BATCH_SUBSTITUTION_ID,
  batchSubstitutionDetail,
  CATALOG_GAP_SUBSTITUTION_ID,
  catalogGapSubstitutionDetail,
  optionalProtocolItem,
  PARQ_PROTOCOL_ID,
  parqProtocolItem,
  protocolDetail,
  PROTOCOL_ID,
  substitutionDetail,
  substitutionMandatoryItem,
  SUBSTITUTION_ID,
} from '../../../test/dashboard-fixtures';

const api = vi.hoisted(() => ({
  getQueueDetail: vi.fn(),
  getAnamnesisAnswers: vi.fn(),
  signProtocol: vi.fn(),
  markNotificationRead: vi.fn(),
  saveProtocol: vi.fn(),
  amendActiveProtocol: vi.fn(),
  approveSubstitutionNow: vi.fn(),
  discardSubstitution: vi.fn(),
  addCatalogExerciseToSubstitutionItem: vi.fn(),
  captureDashboardEvent: vi.fn(),
  searchExerciseCatalog: vi.fn(),
}));
vi.mock('@/lib/dashboard-api', () => ({
  DashboardApiError: class DashboardApiError extends Error {
    constructor(
      readonly status: number,
      message: string,
      readonly details?: unknown,
      readonly code?: string,
      readonly conflicts: unknown[] = [],
    ) {
      super(message);
    }
  },
  ...api,
}));

const reviewHold = vi.hoisted(() => ({ useReviewHold: vi.fn() }));
vi.mock('./use-review-hold', () => reviewHold);

const controlCenterApi = vi.hoisted(() => ({ getExerciseCatalog: vi.fn() }));
vi.mock('@/lib/control-center-api', () => controlCenterApi);

import { DashboardApiError } from '@/lib/dashboard-api';
import type { ExerciseCatalogOption } from '@/lib/dashboard-types';

import { QueueDetail } from './queue-detail';

/**
 * O MESMO detalhe de protocolo, servido pra um item `MANDATORY` de origem PAR-Q. Só o
 * `item` muda (severidade e origem) — `protocol`/`replay` são idênticos ao do opcional,
 * que é exatamente a garantia que o teste de paridade abaixo trava.
 */
const parqProtocolDetail = { ...protocolDetail, item: parqProtocolItem };

/** Opção do catálogo oficial como o autocomplete a recebe do servidor. */
const SUPINO: ExerciseCatalogOption = {
  id: 'supino_reto_halter',
  name: 'Supino Reto (Halter)',
  pattern: 'HORIZONTAL_PUSH',
  muscleGroups: ['peito'],
  equipment: ['halteres'],
  measurement: 'REPS',
  contraindicatedForStudent: [],
};

/** Busca no autocomplete do exercício e seleciona a opção (fluxo real do RT). */
async function pickFromCatalog(input: HTMLElement, query: string, option = SUPINO) {
  api.searchExerciseCatalog.mockResolvedValue([option]);
  await userEvent.clear(input);
  await userEvent.type(input, query);
  await userEvent.click(
    await screen.findByRole('option', { name: new RegExp(option.name.replace(/[()]/g, '\\$&')) }),
  );
}
const optionalProtocolDetail = { ...protocolDetail, item: optionalProtocolItem };

/**
 * Renderiza a tela de revisão de um protocolo e devolve o que o RT de fato percebe:
 * todo o texto (normalizado) e o nome acessível de cada controle acionável. É essa dupla
 * — não o HTML cru, que carrega `useId` e classes utilitárias — que dá pra comparar entre
 * dois detalhes diferentes sem ficar frágil. `assert` roda com a tela ainda montada.
 *
 * `openEditor` entra no modo de edição antes do snapshot. Sem isso a paridade provaria
 * só o estado somente-leitura, e o pedido do fundador fala dos três atos — editar,
 * salvar e assinar. Os campos do editor (`textbox`/`combobox`/`spinbutton`/`radio`) só
 * existem depois do clique, e é neles que uma divergência "só pro caso obrigatório"
 * (campo travado, aviso extra, botão de salvar escondido) apareceria.
 */
async function renderProtocolScreen(
  detail: unknown,
  id: string,
  options: { assert?: () => void; openEditor?: boolean } = {},
): Promise<{ text: string; controls: string[] }> {
  api.getQueueDetail.mockResolvedValue(detail);
  const view = render(<QueueDetail kind="PROTOCOL" id={id} />);
  await screen.findByRole('heading', { name: 'Protocolo para Revisão' });
  // O perfil do aluno chega por uma segunda requisição — sem esperar, o snapshot pegaria
  // o esqueleto de carregamento em vez do conteúdo.
  await screen.findByText(anamnesisAnswers.personal.name);

  if (options.openEditor) {
    await userEvent.click(screen.getByRole('button', { name: 'Editar Protocolo' }));
    // O editor só está montado quando os campos existem.
    await screen.findByRole('combobox', { name: 'Fase' });
  }
  options.assert?.();

  const article = view.container.querySelector('article');
  if (!article) throw new Error('a tela de revisão não montou');
  const scope = within(article);
  const snapshot = {
    text: (article.textContent ?? '').replace(/\s+/g, ' ').trim(),
    controls: [
      // Inclui os controles de FORMULÁRIO, não só button/link: é o que faz a paridade
      // valer também para o editor aberto.
      ...scope.queryAllByRole('button', { hidden: true }),
      ...scope.queryAllByRole('link', { hidden: true }),
      ...scope.queryAllByRole('textbox', { hidden: true }),
      ...scope.queryAllByRole('combobox', { hidden: true }),
      ...scope.queryAllByRole('spinbutton', { hidden: true }),
      ...scope.queryAllByRole('radio', { hidden: true }),
      ...scope.queryAllByRole('checkbox', { hidden: true }),
    ].map((element) =>
      [
        element.tagName,
        element.getAttribute('aria-label') ??
          (element.getAttribute('id')
            ? (article.querySelector(`label[for="${element.getAttribute('id')}"]`)?.textContent ??
              '')
            : '') ??
          '',
        element.textContent?.trim() ?? '',
        // Um campo desabilitado só num dos casos é exatamente o tipo de divergência que
        // a comparação de texto sozinha deixaria passar.
        element.hasAttribute('disabled') ? 'disabled' : '',
      ].join(':'),
    ),
  };
  view.unmount();
  return snapshot;
}

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  controlCenterApi.getExerciseCatalog.mockReset();
  reviewHold.useReviewHold.mockReset();
  api.signProtocol.mockResolvedValue({ status: 'SIGNED' });
  api.markNotificationRead.mockResolvedValue(undefined);
  api.getAnamnesisAnswers.mockResolvedValue(anamnesisAnswers);
  api.approveSubstitutionNow.mockResolvedValue({ status: 'released' });
  api.discardSubstitution.mockResolvedValue({ status: 'discarded' });
  api.addCatalogExerciseToSubstitutionItem.mockResolvedValue({ attached: true });
  controlCenterApi.getExerciseCatalog.mockResolvedValue({
    data: { versions: [], totalPublished: 0 },
    meta: {
      generatedAt: '2026-09-09T12:00:00.000Z',
      timezone: 'America/Sao_Paulo',
      dataQuality: [],
    },
  });
});

// Achado 2026-09-02 — fluxo de substituição de exercício via IA: o profissional pode
// aprovar antes da janela de 30 min ou recusar, mantendo o exercício original.
describe('QueueDetail — substituição de exercício via IA', () => {
  it('mostra a troca proposta e exige confirmação antes de aprovar', async () => {
    api.getQueueDetail.mockResolvedValue(substitutionDetail);
    render(<QueueDetail kind="SUBSTITUTION" id={SUBSTITUTION_ID} />);
    expect(await screen.findByText('Troca proposta')).toBeVisible();
    expect(screen.getByText('Flexão')).toBeVisible();
    expect(screen.getByText('Flexão Diamante')).toBeVisible();
    expect(screen.getByText(/Dias afetados: Dia A, Dia B/)).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Aprovar agora' }));
    expect(api.approveSubstitutionNow).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar e aplicar' }));
    // Sem edição nenhuma: aprova como está (nenhuma decisão por item enviada).
    await waitFor(() =>
      expect(api.approveSubstitutionNow).toHaveBeenCalledWith(SUBSTITUTION_ID, []),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Troca aplicada');
  });

  it('recusa mantém o exercício original, sem chamar aprovação', async () => {
    api.getQueueDetail.mockResolvedValue(substitutionDetail);
    render(<QueueDetail kind="SUBSTITUTION" id={SUBSTITUTION_ID} />);
    await screen.findByText('Troca proposta');

    await userEvent.click(screen.getByRole('button', { name: 'Recusar' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar recusa' }));
    await waitFor(() => expect(api.discardSubstitution).toHaveBeenCalledWith(SUBSTITUTION_ID));
    expect(api.approveSubstitutionNow).not.toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('Troca recusada');
  });

  it('proposta já decidida não mostra ações de aprovar/recusar', async () => {
    const substitution = substitutionDetail.substitution;
    if (!substitution) throw new Error('fixture substitutionDetail sem substitution');
    api.getQueueDetail.mockResolvedValue({
      ...substitutionDetail,
      substitution: { ...substitution, status: 'RELEASED' as const },
    });
    render(<QueueDetail kind="SUBSTITUTION" id={SUBSTITUTION_ID} />);
    await screen.findByText('Troca proposta');
    expect(screen.queryByRole('button', { name: 'Aprovar agora' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Recusar' })).not.toBeInTheDocument();
  });

  it('não mostra "Contexto autorizado" pra substituição (context sempre vazio)', async () => {
    api.getQueueDetail.mockResolvedValue(substitutionDetail);
    render(<QueueDetail kind="SUBSTITUTION" id={SUBSTITUTION_ID} />);
    await screen.findByText('Troca proposta');
    expect(screen.queryByText('Contexto autorizado')).not.toBeInTheDocument();
  });
});

// Achado 2026-09-09 — pedido explícito do aluno por um exercício que não existe em lugar
// nenhum do catálogo: vira revisão obrigatória. Achado 2026-09-30: adicionar ao catálogo liga o
// exercício ao item, mas NÃO aprova — a aprovação é uma decisão à parte, na tela única.
describe('QueueDetail — substituição fora do catálogo (catalogGap)', () => {
  it('mostra "Revisão obrigatória", bloqueia "Aprovar agora" e oferece adicionar ao catálogo', async () => {
    api.getQueueDetail.mockResolvedValue(catalogGapSubstitutionDetail);
    render(<QueueDetail kind="SUBSTITUTION" id={CATALOG_GAP_SUBSTITUTION_ID} />);

    expect(await screen.findByText('Troca proposta')).toBeVisible();
    expect(screen.getByText('Revisão obrigatória')).toBeVisible();
    expect(screen.getByText('“Supino Reto Máquina” (fora do catálogo)')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Aprovar agora' })).toBeDisabled();
    expect(screen.getByRole('note')).toHaveTextContent('fora do catálogo');
    expect(
      screen.getByRole('button', { name: /Adicionar ao catálogo: Supino Reto Máquina/ }),
    ).toBeVisible();
  });

  it('publica o exercício e o liga ao item, sem aprovar a troca', async () => {
    api.getQueueDetail.mockResolvedValue(catalogGapSubstitutionDetail);
    render(<QueueDetail kind="SUBSTITUTION" id={CATALOG_GAP_SUBSTITUTION_ID} />);
    await screen.findByText('Troca proposta');

    await userEvent.click(screen.getByRole('button', { name: /Adicionar ao catálogo: Supino/ }));
    const dialog = await screen.findByRole('dialog');
    const scope = within(dialog);

    expect(scope.getByLabelText('Nome do exercício')).toHaveValue('Supino Reto Máquina');
    await userEvent.click(scope.getByText('Selecione o(s) músculo(s)'));
    await userEvent.click(scope.getByRole('checkbox', { name: 'peito' }));
    await userEvent.click(scope.getByRole('checkbox', { name: /Academia completa/ }));
    const adicionar = scope.getByRole('button', { name: 'Adicionar ao catálogo' });
    // Nível (achado 2026-09-29): mesmo combo do modal da tela Exercícios, obrigatório.
    const nivel = scope.getByRole('group', { name: 'Nível' });
    expect(within(nivel).getAllByRole('checkbox')).toHaveLength(3);
    expect(adicionar).toBeDisabled();
    await userEvent.click(within(nivel).getByRole('checkbox', { name: 'Avançado' }));
    await userEvent.click(within(nivel).getByRole('checkbox', { name: 'Intermediário' }));
    expect(adicionar).toBeEnabled();

    await userEvent.click(adicionar);

    await waitFor(() =>
      expect(api.addCatalogExerciseToSubstitutionItem).toHaveBeenCalledWith(
        CATALOG_GAP_SUBSTITUTION_ID,
        0,
        expect.objectContaining({
          name: 'Supino Reto Máquina',
          muscleGroups: ['peito'],
          locations: ['FULL_GYM'],
          levels: ['INTERMEDIARIO', 'AVANCADO'],
          pattern: 'ISOLATION',
          contraindicatedFor: [],
          substitutes: [],
          equipment: [],
        }),
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Agora revise e aprove');
    expect(api.approveSubstitutionNow).not.toHaveBeenCalled();
  });

  it('não deixa adicionar sem selecionar músculo, nível e local', async () => {
    api.getQueueDetail.mockResolvedValue(catalogGapSubstitutionDetail);
    render(<QueueDetail kind="SUBSTITUTION" id={CATALOG_GAP_SUBSTITUTION_ID} />);
    await screen.findByText('Troca proposta');

    await userEvent.click(screen.getByRole('button', { name: /Adicionar ao catálogo: Supino/ }));
    const dialog = await screen.findByRole('dialog');
    const scope = within(dialog);
    const adicionar = scope.getByRole('button', { name: 'Adicionar ao catálogo' });
    expect(adicionar).toBeDisabled();

    // Músculo e local sem nível: continua bloqueado.
    await userEvent.click(scope.getByRole('checkbox', { name: 'peito' }));
    await userEvent.click(scope.getByRole('checkbox', { name: /Academia completa/ }));
    expect(adicionar).toBeDisabled();
    await userEvent.click(adicionar);
    expect(api.addCatalogExerciseToSubstitutionItem).not.toHaveBeenCalled();
  });
});

// Achado 2026-09-30 — troca em lote: a proposta carrega até 3 trocas no mesmo registro, e o
// profissional aprova, edita ou descarta cada uma individualmente na tela única.
describe('QueueDetail — troca em lote (itens da proposta)', () => {
  it('lista todas as trocas da proposta numa única tela', async () => {
    api.getQueueDetail.mockResolvedValue(batchSubstitutionDetail);
    render(<QueueDetail kind="SUBSTITUTION" id={BATCH_SUBSTITUTION_ID} />);

    expect(await screen.findByText('Trocas propostas')).toBeVisible();
    expect(screen.getByText('Leg Press 45°')).toBeVisible();
    expect(screen.getByText('Agachamento Hack')).toBeVisible();
    expect(screen.getByText('Cadeira Extensora')).toBeVisible();
    expect(screen.getByText('“Extensora Unilateral” (fora do catálogo)')).toBeVisible();
    expect(screen.getByText('Mesa Flexora')).toBeVisible();
    expect(screen.getByText('Cadeira Flexora')).toBeVisible();
  });

  it('edita um item (outra opção segura) e descarta outro, enviando uma decisão por item', async () => {
    api.getQueueDetail.mockResolvedValue(batchSubstitutionDetail);
    render(<QueueDetail kind="SUBSTITUTION" id={BATCH_SUBSTITUTION_ID} />);
    await screen.findByText('Trocas propostas');

    // Item 0: troca o Hack por Afundo (edição). Item 1 (fora do catálogo): descarta. Item 2: mantém.
    const trocaLegPress = screen.getByRole('listitem', { name: /Troca 1/ });
    await userEvent.selectOptions(
      within(trocaLegPress).getByLabelText('Trocar por outra opção segura'),
      'afundo',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Descartar a troca de Cadeira Extensora' }),
    );
    expect(screen.getByText('Item descartado')).toBeVisible();

    // Com o pedido de catálogo descartado, o bloqueio de aprovação some.
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar agora' }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar e aplicar' }));

    await waitFor(() =>
      expect(api.approveSubstitutionNow).toHaveBeenCalledWith(BATCH_SUBSTITUTION_ID, [
        { index: 0, action: 'APPROVE', toExerciseId: 'afundo' },
        { index: 1, action: 'DISCARD' },
      ]),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Trocas aplicadas');
  });

  it('bloqueia a aprovação enquanto houver pedido de catálogo sem resolução', async () => {
    api.getQueueDetail.mockResolvedValue(batchSubstitutionDetail);
    render(<QueueDetail kind="SUBSTITUTION" id={BATCH_SUBSTITUTION_ID} />);
    await screen.findByText('Trocas propostas');

    expect(screen.getByRole('button', { name: 'Aprovar agora' })).toBeDisabled();
    expect(screen.getByRole('note')).toHaveTextContent('fora do catálogo');
  });

  it('desfazer o descarte devolve o item à aprovação', async () => {
    api.getQueueDetail.mockResolvedValue(batchSubstitutionDetail);
    render(<QueueDetail kind="SUBSTITUTION" id={BATCH_SUBSTITUTION_ID} />);
    await screen.findByText('Trocas propostas');

    await userEvent.click(
      screen.getByRole('button', { name: 'Descartar a troca de Mesa Flexora' }),
    );
    expect(screen.getByText('Item descartado')).toBeVisible();
    await userEvent.click(
      screen.getByRole('button', { name: 'Desfazer o descarte da troca de Mesa Flexora' }),
    );
    expect(screen.queryByText('Item descartado')).not.toBeInTheDocument();
  });

  it('adiciona ao catálogo o item certo da proposta (por posição)', async () => {
    api.getQueueDetail.mockResolvedValue(batchSubstitutionDetail);
    render(<QueueDetail kind="SUBSTITUTION" id={BATCH_SUBSTITUTION_ID} />);
    await screen.findByText('Trocas propostas');

    await userEvent.click(
      screen.getByRole('button', { name: /Adicionar ao catálogo: Extensora Unilateral/ }),
    );
    const scope = within(await screen.findByRole('dialog'));
    expect(scope.getByLabelText('Nome do exercício')).toHaveValue('Extensora Unilateral');
    await userEvent.click(scope.getByText('Selecione o(s) músculo(s)'));
    await userEvent.click(scope.getByRole('checkbox', { name: 'quadríceps' }));
    await userEvent.click(scope.getByRole('checkbox', { name: /Academia completa/ }));
    await userEvent.click(
      within(scope.getByRole('group', { name: 'Nível' })).getByRole('checkbox', {
        name: 'Iniciante',
      }),
    );
    await userEvent.click(scope.getByRole('button', { name: 'Adicionar ao catálogo' }));

    await waitFor(() =>
      expect(api.addCatalogExerciseToSubstitutionItem).toHaveBeenCalledWith(
        BATCH_SUBSTITUTION_ID,
        1,
        expect.objectContaining({ name: 'Extensora Unilateral' }),
      ),
    );
  });

  it('descartar todos os itens esconde "Aprovar agora" e deixa só "Recusar"', async () => {
    api.getQueueDetail.mockResolvedValue(batchSubstitutionDetail);
    render(<QueueDetail kind="SUBSTITUTION" id={BATCH_SUBSTITUTION_ID} />);
    await screen.findByText('Trocas propostas');

    await userEvent.click(
      screen.getByRole('button', { name: 'Descartar a troca de Leg Press 45°' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Descartar a troca de Cadeira Extensora' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Descartar a troca de Mesa Flexora' }),
    );

    expect(screen.queryByRole('button', { name: 'Aprovar agora' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Recusar' })).toBeVisible();
  });
});

describe('QueueDetail — trava do envio automático enquanto a tela está aberta', () => {
  const optionalDetail = { ...protocolDetail, item: optionalProtocolItem };

  it('protocolo com envio automático agendado: segura o envio enquanto a tela está aberta', async () => {
    api.getQueueDetail.mockResolvedValue(optionalDetail);
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await screen.findByRole('heading', { name: /Protocolo · versão 1/i });

    expect(reviewHold.useReviewHold).toHaveBeenLastCalledWith('PROTOCOL', PROTOCOL_ID, true);
    // Silencioso: nenhuma faixa extra (a tela do opcional é idêntica à do obrigatório).
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('troca de exercício com liberação automática agendada: segura o envio (recurso substitutions)', async () => {
    api.getQueueDetail.mockResolvedValue(substitutionDetail); // opcional: tem `autoReleaseAt`
    render(<QueueDetail kind="SUBSTITUTION" id={SUBSTITUTION_ID} />);
    await screen.findByText('Troca proposta');
    expect(reviewHold.useReviewHold).toHaveBeenLastCalledWith(
      'SUBSTITUTION',
      SUBSTITUTION_ID,
      true,
    );
  });

  it('troca de exercício obrigatória (sem liberação automática): não segura nada', async () => {
    api.getQueueDetail.mockResolvedValue({
      ...substitutionDetail,
      item: substitutionMandatoryItem,
    });
    render(<QueueDetail kind="SUBSTITUTION" id={SUBSTITUTION_ID} />);
    await screen.findByText('Troca proposta');
    expect(reviewHold.useReviewHold).toHaveBeenLastCalledWith(
      'SUBSTITUTION',
      SUBSTITUTION_ID,
      false,
    );
  });

  it('protocolo obrigatório (sem envio automático): não segura nada', async () => {
    api.getQueueDetail.mockResolvedValue(parqProtocolDetail);
    render(<QueueDetail kind="PROTOCOL" id={PARQ_PROTOCOL_ID} />);
    await screen.findByRole('heading', { name: /Protocolo · versão 1/i });

    expect(reviewHold.useReviewHold).toHaveBeenLastCalledWith('PROTOCOL', PARQ_PROTOCOL_ID, false);
  });

  it('enquanto o detalhe carrega a trava ainda está desligada', () => {
    api.getQueueDetail.mockReturnValue(new Promise(() => undefined));
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    expect(reviewHold.useReviewHold).toHaveBeenLastCalledWith('PROTOCOL', PROTOCOL_ID, false);
  });
});

describe('QueueDetail', () => {
  it('renderiza protocolo e exige confirmação para assinar', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    expect(await screen.findByRole('heading', { name: /Protocolo · versão 1/i })).toBeVisible();
    expect(screen.getByText('Relatei dificuldade no exercício de hoje.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Assinar e liberar' }));
    expect(api.signProtocol).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar e assinar' }));
    await waitFor(() => expect(api.signProtocol).toHaveBeenCalledWith(PROTOCOL_ID, []));
    expect(await screen.findByRole('status')).toHaveTextContent('auditoria registrada');
  });

  it('identifica a tela como notificação da Fila do Profissional e registra a leitura', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await screen.findByRole('heading', { name: /Protocolo · versão 1/i });
    expect(screen.getByText('Fila do Profissional · Notificação')).toBeVisible();
    expect(
      screen.getByRole('link', { name: /voltar para a fila do profissional/i }),
    ).toHaveAttribute('href', '/dashboard/educacao-fisica');
    await waitFor(() =>
      expect(api.markNotificationRead).toHaveBeenCalledWith('protocol', PROTOCOL_ID),
    );
  });

  it('não registra leitura enquanto o detalhe não carregou', async () => {
    api.getQueueDetail.mockRejectedValue(new Error('Caso indisponível'));
    render(<QueueDetail kind="SUBSTITUTION" id={SUBSTITUTION_ID} />);
    await screen.findByRole('alert');
    expect(api.markNotificationRead).not.toHaveBeenCalled();
  });

  // Achado 2026-08-19 (a pedido do fundador): "Contexto autorizado" só repetia a versão
  // (já no título) e um booleano sempre `true` — sem valor pro RT nesta tela.
  it('não mostra "Contexto autorizado" pra protocolo', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await screen.findByRole('heading', { name: /Protocolo · versão 1/i });
    expect(screen.queryByText('Contexto autorizado')).not.toBeInTheDocument();
  });

  // Achado 2026-08-19 (a pedido do fundador): editar acontece DENTRO do próprio card
  // "Protocolo · versão N" — o mesmo componente vira formulário, sem trocar de layout.
  it('edita o protocolo dentro do próprio card e salva sem pedir motivo', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    api.saveProtocol.mockResolvedValue({ status: 'PENDING_REVIEW' });
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    expect(await screen.findByRole('heading', { name: /Protocolo · versão 1/i })).toBeVisible();
    expect(screen.getByText('Agachamento goblet')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Editar Protocolo' }));
    await pickFromCatalog(screen.getByLabelText('Exercício do catálogo'), 'supino');
    expect(api.searchExerciseCatalog).toHaveBeenCalledWith(
      'supino',
      expect.objectContaining({ protocolId: PROTOCOL_ID }),
    );
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    // O que vai para o servidor é o id OFICIAL e a grafia do catálogo — nunca o texto digitado.
    await waitFor(() =>
      expect(api.saveProtocol).toHaveBeenCalledWith(
        PROTOCOL_ID,
        expect.objectContaining({
          sessions: [
            expect.objectContaining({
              exercises: [
                expect.objectContaining({
                  exerciseId: 'supino_reto_halter',
                  name: 'Supino Reto (Halter)',
                }),
              ],
            }),
          ],
        }),
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Edição validada no servidor');
    // Volta pro card de leitura, ainda dentro do mesmo componente.
    expect(screen.getByRole('button', { name: 'Editar Protocolo' })).toBeVisible();
  });

  it('versiona e publica a alteração de um protocolo ativo com motivo', async () => {
    if (!protocolDetail.protocol) throw new Error('fixture sem protocolo');
    api.getQueueDetail.mockResolvedValue({
      ...protocolDetail,
      protocol: {
        ...protocolDetail.protocol,
        status: 'ACTIVE',
        approvalStatus: 'HUMAN_APPROVED',
        signedAt: '2026-10-12T12:00:00.000Z',
        signatureHash: 'a'.repeat(64),
      },
    });
    api.amendActiveProtocol.mockResolvedValue({ status: 'ACTIVE' });
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Protocolo' }));
    await userEvent.type(screen.getByLabelText('Motivo da atualização'), 'Troca manual segura');
    await userEvent.click(screen.getByRole('button', { name: 'Salvar e publicar atualização' }));

    await waitFor(() =>
      expect(api.amendActiveProtocol).toHaveBeenCalledWith(
        PROTOCOL_ID,
        expect.objectContaining({
          expectedVersion: 1,
          reason: 'Troca manual segura',
          confirmation: true,
        }),
      ),
    );
    expect(api.saveProtocol).not.toHaveBeenCalled();
  });

  it('edição com divergência das regras automáticas é gravada e avisa que a confirmação é na assinatura', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    api.saveProtocol.mockResolvedValue({
      status: 'PENDING_SIGNATURE',
      validation: 'PROFESSIONAL_CONFLICTS',
      conflicts: [
        {
          key: 'ISOLATION_AS_BASE:Dia A: 3 isolados de 4 exercícios',
          rule: 'ISOLATION_AS_BASE',
          detail: 'Dia A: 3 isolados de 4 exercícios',
        },
      ],
    });
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Protocolo' }));
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Alterações salvas. Ao assinar, confirme as divergências das regras automáticas: Isolados como base da sessão: Dia A: 3 isolados de 4 exercícios.',
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Editar Protocolo' })).toBeVisible();
  });

  it('cancela a edição do protocolo sem persistir mudanças', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Protocolo' }));
    await pickFromCatalog(screen.getByLabelText('Exercício do catálogo'), 'supino');
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar edição' }));
    expect(screen.getByText('Agachamento goblet')).toBeVisible();
    expect(api.saveProtocol).not.toHaveBeenCalled();
  });

  it('não pede motivo da edição: salvar sem alterar nada persiste direto', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    api.saveProtocol.mockResolvedValue({ status: 'PENDING_REVIEW' });
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Protocolo' }));
    expect(screen.queryByLabelText(/motivo da edição/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    await waitFor(() => expect(api.saveProtocol).toHaveBeenCalledTimes(1));
    expect(api.saveProtocol).toHaveBeenCalledWith(PROTOCOL_ID, expect.anything());
  });

  // Achado 2026-08-18 (decisão do fundador): título da sessão vira
  // `DIA DA SEMANA | NOME DO TREINO | FASE` em vez de `dayLabel · focus` cru.
  it('título da sessão: dia da semana real | nome do treino | fase', async () => {
    const baseProtocol = protocolDetail.protocol;
    const baseSession = baseProtocol?.content.sessions[0];
    if (!baseProtocol || !baseSession) throw new Error('fixture inválida');
    api.getQueueDetail.mockResolvedValue({
      ...protocolDetail,
      protocol: {
        ...baseProtocol,
        content: {
          ...baseProtocol.content,
          phase: 'HIPERTROFIA',
          sessions: [{ ...baseSession, weekday: 'TUE' }],
        },
      },
    });
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    expect(await screen.findByText('Terça | Membros inferiores | Hipertrofia')).toBeVisible();
  });

  it('sem weekday (protocolo antigo): cai pro dayLabel cru, sem quebrar', async () => {
    const session = protocolDetail.protocol?.content.sessions[0]; // fixture não tem weekday
    if (!session) throw new Error('fixture inválida');
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    expect(
      await screen.findByText(`${session.dayLabel} | ${session.focus} | Hipertrofia`),
    ).toBeVisible();
  });

  /**
   * Garantia de regressão CENTRAL do refactor de 2026-08-24 (exigência do fundador): o
   * protocolo que nasce de um PAR-Q bloqueante chega como item `PROTOCOL` normal, só que
   * `MANDATORY`/`SAFETY`, e a tela de revisão dele tem que ser INDISTINGUÍVEL da de um
   * protocolo opcional — mesmo header, mesmo editor, mesmo "Assinar e liberar" (que agora
   * também libera o PAR-Q, no backend). Comparar o texto renderizado e a lista de
   * controles é o que trava isso: qualquer faixa, aviso ou botão que alguém volte a
   * adicionar só pro caso obrigatório quebra aqui.
   */
  it('PAR-Q bloqueante (MANDATORY/SAFETY) renderiza exatamente a mesma tela do protocolo OPTIONAL', async () => {
    const optional = await renderProtocolScreen(optionalProtocolDetail, PROTOCOL_ID);
    const mandatory = await renderProtocolScreen(parqProtocolDetail, PARQ_PROTOCOL_ID, {
      assert: () => {
        expect(screen.getByRole('heading', { name: /Protocolo · versão 1/i })).toBeVisible();
        expect(screen.getByRole('button', { name: 'Editar Protocolo' })).toBeVisible();
        expect(screen.getByRole('button', { name: 'Assinar e liberar' })).toBeVisible();
        // Nem a faixa de severidade do header genérico, nem a tela morta de liberação.
        expect(screen.queryByText('SEGURANÇA · PRIORIDADE')).not.toBeInTheDocument();
        expect(screen.queryByText('Liberação humana PAR-Q')).not.toBeInTheDocument();
        expect(
          screen.queryByRole('button', { name: 'Registrar liberação' }),
        ).not.toBeInTheDocument();
      },
    });

    // Trava o próprio snapshot: sem isto, um helper que devolvesse vazio faria o
    // `toEqual` abaixo passar sem comparar nada.
    expect(optional.text).toContain('Protocolo · versão 1');
    expect(optional.controls.some((c) => c.includes('Assinar e liberar'))).toBe(true);
    expect(optional.controls).toContain('BUTTON:Editar Protocolo::');

    expect(mandatory).toEqual(optional);
  });

  /**
   * A paridade acima cobre a tela em repouso. Esta cobre o ato de EDITAR e SALVAR: o
   * editor aberto tem que ser igual nos dois casos — mesmos campos, nenhum desabilitado
   * só porque o protocolo é obrigatório, e o mesmo botão de salvar. É o cenário em que
   * uma "proteção extra" bem-intencionada (travar a fase de quem tem PAR-Q, esconder o
   * salvar) quebraria a promessa de tela idêntica sem mudar uma linha de texto estático.
   */
  it('em modo de EDIÇÃO, PAR-Q bloqueante mantém os mesmos campos e o mesmo salvar', async () => {
    const optional = await renderProtocolScreen(optionalProtocolDetail, PROTOCOL_ID, {
      openEditor: true,
    });
    const mandatory = await renderProtocolScreen(parqProtocolDetail, PARQ_PROTOCOL_ID, {
      openEditor: true,
    });

    // Anti-vacuidade: o editor realmente abriu e trouxe os controles esperados.
    expect(optional.controls.some((c) => c.includes('Salvar'))).toBe(true);
    expect(optional.controls.some((c) => c.includes('Cancelar edição'))).toBe(true);
    // Campos de fato editáveis do formulário — prova que o editor abriu, não só o rodapé.
    expect(optional.controls.some((c) => c.includes('Séries válidas'))).toBe(true);
    expect(optional.controls.some((c) => c.includes('Repetições em Reserva'))).toBe(true);
    // O editor tem MUITO mais controles que a tela em repouso; se algum dia abrir sem
    // montar os campos, o `toEqual` ainda passaria por comparar duas listas curtas iguais.
    expect(optional.controls.length).toBeGreaterThan(20);

    expect(mandatory).toEqual(optional);
  });

  it('oferece recuperação quando o detalhe falha', async () => {
    api.getQueueDetail
      .mockRejectedValueOnce(new Error('Caso indisponível'))
      .mockResolvedValueOnce(protocolDetail);
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Caso indisponível');
    await userEvent.click(screen.getByRole('button', { name: /tentar novamente/i }));
    expect(await screen.findByRole('heading', { name: 'Protocolo para Revisão' })).toBeVisible();
  });

  // Achado 2026-08-19 (a pedido do fundador): card do topo vira o perfil estruturado do
  // aluno, cruzando o protocolo (fase/duração) com a anamnese (idade/peso/altura/PAR-Q).
  it('mostra o card "Protocolo para Revisão" com o perfil do aluno', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    expect(await screen.findByRole('heading', { name: 'Protocolo para Revisão' })).toBeVisible();
    expect(await screen.findByText('Rodrigo de Barros')).toBeVisible();
    expect(screen.getByText(/36 anos/)).toBeVisible();
    expect(screen.getByText(/80kg/)).toBeVisible();
    expect(screen.getByText(/178 cm/)).toBeVisible();
    expect(screen.getByText(/Masculino/)).toBeVisible();
    expect(screen.getByText(/3x por semana \| Segunda, Quarta, Sexta/)).toBeVisible();
    expect(screen.getByText('Nenhum fator de risco identificado.')).toBeVisible();
    // Objetivo (GAIN_MUSCLE) e Mesociclo (fase HIPERTROFIA) coincidem no rótulo nesta
    // fixture — as duas linhas do card aparecem, cada uma com seu "Hipertrofia".
    expect(screen.getAllByText('Hipertrofia')).toHaveLength(2);
  });

  // Achado 2026-09-03 (a pedido do fundador): fatores de risco viram rótulo curto, não a
  // pergunta inteira do PAR-Q — e sempre na ordem Q1→Q9, não a ordem crua do array.
  it('resume os fatores de risco com rótulo curto, na ordem Q1→Q9', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    api.getAnamnesisAnswers.mockResolvedValue({
      ...anamnesisAnswers,
      health: {
        ...anamnesisAnswers.health,
        parq: {
          version: 'parq-2026-07-v1' as const,
          // Fora de ordem de propósito (Q6 antes de Q1) — trava a normalização.
          answers: (['Q6', 'Q2', 'Q3', 'Q4', 'Q5', 'Q1', 'Q7', 'Q8', 'Q9'] as ParqQuestionId[]).map(
            (questionId) => ({ questionId, answer: questionId === 'Q6' || questionId === 'Q1' }),
          ),
        },
      },
    });
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);

    expect(await screen.findByText('coração/pressão alta, osso/articulação/coluna')).toBeVisible();
    expect(
      screen.queryByText(/O seu médico já disse que você tem algum problema no coração/),
    ).not.toBeInTheDocument();
  });

  // Achado 2026-09-03 (a pedido do fundador): o RT precisa ver o formulário completo sem
  // sair da tela de edição — mesmo modal que o "olho" da fila já abre.
  it('o olho ao lado de "Editar Protocolo" abre as respostas completas da anamnese', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await screen.findByRole('button', { name: 'Editar Protocolo' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Ver respostas da anamnese' }));

    const dialog = await screen.findByRole('dialog', { name: 'Respostas da anamnese' });
    expect(within(dialog).getByText('Rodrigo de Barros')).toBeVisible();
  });

  it('edita todos os campos do protocolo (sessão, exercício e observações gerais) e salva', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    api.saveProtocol.mockResolvedValue({ status: 'PENDING_REVIEW' });
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await screen.findByRole('heading', { name: /Protocolo · versão 1/i });

    await userEvent.click(screen.getByRole('button', { name: 'Editar Protocolo' }));

    // Combobox custom (não é <select> nativo — `selectOptions` não se aplica): abre o
    // gatilho pelo nome acessível e clica a opção na listbox.
    await userEvent.click(screen.getByRole('combobox', { name: 'Fase' }));
    await userEvent.click(screen.getByRole('option', { name: 'Força' }));

    await userEvent.click(screen.getByRole('radio', { name: '4x' }));

    // Os inputs de dayLabel/foco fazem `preventDefault` no click (pra não abrir/fechar o
    // <details>), o que também bloqueia a seleção usada por `userEvent.clear`/`type` —
    // por isso o valor é setado direto via `fireEvent.change`.
    fireEvent.change(screen.getByLabelText('Identificação do dia — sessão 1'), {
      target: { value: 'Treino Z' },
    });
    fireEvent.change(screen.getByLabelText('Foco — sessão 1'), {
      target: { value: 'Posterior de coxa' },
    });

    await pickFromCatalog(screen.getByLabelText('Exercício do catálogo'), 'supino');
    const notes = screen.getByLabelText('Observação');
    await userEvent.clear(notes);
    await userEvent.type(notes, 'Cuidado com a lombar');

    const sets = screen.getByLabelText('Séries válidas');
    await userEvent.clear(sets);
    await userEvent.type(sets, '5');
    const repsMin = screen.getByLabelText('Repetições mín.');
    await userEvent.clear(repsMin);
    await userEvent.type(repsMin, '6');
    const repsMax = screen.getByLabelText('Repetições máx.');
    await userEvent.clear(repsMax);
    await userEvent.type(repsMax, '9');
    const rest = screen.getByLabelText('Descanso (s)');
    await userEvent.clear(rest);
    await userEvent.type(rest, '120');

    const rir = screen.getByLabelText('Repetições em Reserva (RIR)');
    await userEvent.clear(rir);
    await userEvent.type(rir, '3');

    await userEvent.click(screen.getByRole('combobox', { name: 'Técnica avançada' }));
    await userEvent.click(screen.getByRole('option', { name: 'Drop-set' }));

    const videoUrl = screen.getByLabelText('Link de vídeo de execução');
    await userEvent.clear(videoUrl);
    await userEvent.type(videoUrl, 'https://example.com/supino');

    const generalNotes = screen.getByLabelText(/Observações gerais/i);
    await userEvent.clear(generalNotes);
    await userEvent.type(generalNotes, 'Nova observação geral');

    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.saveProtocol).toHaveBeenCalledWith(
        PROTOCOL_ID,
        expect.objectContaining({
          phase: 'FORCA',
          weeklyFrequency: 4,
          generalNotes: 'Nova observação geral',
          sessions: [
            expect.objectContaining({
              dayLabel: 'Treino Z',
              focus: 'Posterior de coxa',
              exercises: [
                expect.objectContaining({
                  exerciseId: 'supino_reto_halter',
                  name: 'Supino Reto (Halter)',
                  notes: 'Cuidado com a lombar',
                  sets: 5,
                  reps: { min: 6, max: 9 },
                  restSeconds: 120,
                  rir: 3,
                  technique: 'DROP_SET',
                  videoUrl: 'https://example.com/supino',
                }),
              ],
            }),
          ],
        }),
      ),
    );
  });

  it('reordenar: o botão fica desabilitado com um exercício só', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Protocolo' }));
    expect(screen.getByRole('button', { name: /reordenar exercícios/i })).toBeDisabled();
  });

  it('reordenar: mostra a lista com alças de arrastar e preserva a ordem ao concluir', async () => {
    const baseProtocol = protocolDetail.protocol;
    if (!baseProtocol) throw new Error('fixture inválida');
    const baseSession = baseProtocol.content.sessions[0];
    const first = baseSession?.exercises[0];
    if (!baseSession || !first) throw new Error('fixture inválida');
    api.getQueueDetail.mockResolvedValue({
      ...protocolDetail,
      protocol: {
        ...baseProtocol,
        content: {
          ...baseProtocol.content,
          sessions: [
            {
              ...baseSession,
              exercises: [
                { ...first, exerciseId: 'ex-a', name: 'Exercício A' },
                { ...first, exerciseId: 'ex-b', name: 'Exercício B' },
              ],
            },
          ],
        },
      },
    });
    api.saveProtocol.mockResolvedValue({ status: 'PENDING_REVIEW' });
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Protocolo' }));

    await userEvent.click(screen.getByRole('button', { name: /reordenar exercícios/i }));
    const list = screen.getByRole('list', { name: /ordem dos exercícios/i });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Exercício A'),
      expect.stringContaining('Exercício B'),
    ]);
    expect(
      within(list).getByRole('button', { name: /arrastar "exercício b" \(posição 2\)/i }),
    ).toBeVisible();
    // Enquanto reordena, os campos de edição saem da frente.
    expect(screen.queryByLabelText('Exercício do catálogo')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /concluir ordem/i }));
    expect(screen.getAllByLabelText('Exercício do catálogo')).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    await waitFor(() =>
      expect(api.saveProtocol).toHaveBeenCalledWith(
        PROTOCOL_ID,
        expect.objectContaining({
          sessions: [
            expect.objectContaining({
              exercises: [
                expect.objectContaining({ exerciseId: 'ex-a' }),
                expect.objectContaining({ exerciseId: 'ex-b' }),
              ],
            }),
          ],
        }),
      ),
    );
  });

  it('reordenar: arrastar um exercício (teclado) troca a ordem e salva na nova ordem', async () => {
    const baseProtocol = protocolDetail.protocol;
    if (!baseProtocol) throw new Error('fixture inválida');
    const baseSession = baseProtocol.content.sessions[0];
    const first = baseSession?.exercises[0];
    if (!baseSession || !first) throw new Error('fixture inválida');
    api.getQueueDetail.mockResolvedValue({
      ...protocolDetail,
      protocol: {
        ...baseProtocol,
        content: {
          ...baseProtocol.content,
          sessions: [
            {
              ...baseSession,
              exercises: ['A', 'B', 'C'].map((letter) => ({
                ...first,
                exerciseId: `ex-${letter.toLowerCase()}`,
                name: `Exercício ${letter}`,
              })),
            },
          ],
        },
      },
    });
    api.saveProtocol.mockResolvedValue({ status: 'PENDING_REVIEW' });

    // jsdom não tem layout: cada linha ganha um retângulo empilhado, senão o sensor de
    // teclado do dnd-kit não tem pra onde mover.
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const row = this.closest('li');
        const index = row ? Array.from(row.parentElement?.children ?? []).indexOf(row) : 0;
        const top = row ? index * 60 : 0;
        return {
          x: 0,
          y: top,
          top,
          bottom: top + 50,
          left: 0,
          right: 300,
          width: 300,
          height: 50,
          toJSON: () => ({}),
        };
      });

    try {
      render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
      await userEvent.click(await screen.findByRole('button', { name: 'Editar Protocolo' }));
      await userEvent.click(screen.getByRole('button', { name: /reordenar exercícios/i }));

      const handle = screen.getByRole('button', { name: /arrastar "exercício a"/i });
      handle.focus();
      await userEvent.keyboard(' ');
      await userEvent.keyboard('{ArrowDown}');
      await userEvent.keyboard(' ');

      await waitFor(() => {
        const names = within(screen.getByRole('list', { name: /ordem dos exercícios/i }))
          .getAllByRole('listitem')
          .map((row) => row.textContent);
        expect(names[0]).toContain('Exercício B');
        expect(names[1]).toContain('Exercício A');
      });

      await userEvent.click(screen.getByRole('button', { name: /concluir ordem/i }));
      await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
      await waitFor(() =>
        expect(api.saveProtocol).toHaveBeenCalledWith(
          PROTOCOL_ID,
          expect.objectContaining({
            sessions: [
              expect.objectContaining({
                exercises: [
                  expect.objectContaining({ exerciseId: 'ex-b' }),
                  expect.objectContaining({ exerciseId: 'ex-a' }),
                  expect.objectContaining({ exerciseId: 'ex-c' }),
                ],
              }),
            ],
          }),
        ),
      );
    } finally {
      rect.mockRestore();
    }
  });

  it('adiciona e remove exercício respeitando o mínimo de um por sessão', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await screen.findByRole('heading', { name: /Protocolo · versão 1/i });
    await userEvent.click(screen.getByRole('button', { name: 'Editar Protocolo' }));

    // Fixture tem 1 exercício só — remover fica desabilitado (schema exige mínimo 1).
    expect(screen.getByRole('button', { name: /remover exercício/i })).toBeDisabled();
    expect(screen.getAllByLabelText('Exercício do catálogo')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: /adicionar exercício/i }));
    expect(screen.getAllByLabelText('Exercício do catálogo')).toHaveLength(2);
    const removeButtons = screen.getAllByRole('button', { name: /remover exercício/i });
    expect(removeButtons).toHaveLength(2);
    removeButtons.forEach((button) => expect(button).not.toBeDisabled());

    await userEvent.click(removeButtons[1] as HTMLElement);
    expect(screen.getAllByLabelText('Exercício do catálogo')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /remover exercício/i })).toBeDisabled();
  });

  it('adiciona bloco de aquecimento com range próprio e salva junto com a série válida', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    api.saveProtocol.mockResolvedValue({ status: 'PENDING_REVIEW' });
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await screen.findByRole('heading', { name: /Protocolo · versão 1/i });
    await userEvent.click(screen.getByRole('button', { name: 'Editar Protocolo' }));

    expect(screen.queryByLabelText(/Séries do bloco de aquecimento/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /adicionar bloco de aquecimento/i }));
    expect(screen.getByLabelText(/Séries do bloco de aquecimento/i)).toBeInTheDocument();

    // Remover volta ao estado sem aquecimento (campo vira `undefined`, não [] vazio).
    await userEvent.click(screen.getByRole('button', { name: /remover bloco de aquecimento 1/i }));
    expect(screen.queryByLabelText(/Séries do bloco de aquecimento/i)).not.toBeInTheDocument();

    // Adiciona de novo pra seguir com o fluxo real de salvar.
    await userEvent.click(screen.getByRole('button', { name: /adicionar bloco de aquecimento/i }));
    const warmupSets = screen.getByLabelText('Séries do bloco de aquecimento 1');
    await userEvent.clear(warmupSets);
    await userEvent.type(warmupSets, '2');
    const warmupMin = screen.getByLabelText('Repetições mín. do bloco de aquecimento 1');
    await userEvent.clear(warmupMin);
    await userEvent.type(warmupMin, '18');
    const warmupMax = screen.getByLabelText('Repetições máx. do bloco de aquecimento 1');
    await userEvent.clear(warmupMax);
    await userEvent.type(warmupMax, '20');

    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.saveProtocol).toHaveBeenCalledWith(
        PROTOCOL_ID,
        expect.objectContaining({
          sessions: [
            expect.objectContaining({
              exercises: [
                expect.objectContaining({
                  warmupBlocks: [{ sets: 2, reps: { min: 18, max: 20 }, restSeconds: 30 }],
                  // Série válida (sets/reps de topo) continua intacta, sem migração.
                  sets: 3,
                  reps: { min: 8, max: 10 },
                }),
              ],
            }),
          ],
        }),
      ),
    );
  });

  it('alterna um exercício entre repetições e duração pelo seletor de medida', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    api.saveProtocol.mockResolvedValue({ status: 'PENDING_REVIEW' });
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await screen.findByRole('heading', { name: /Protocolo · versão 1/i });
    await userEvent.click(screen.getByRole('button', { name: 'Editar Protocolo' }));

    // Fixture começa em modo repetições.
    expect(screen.getByLabelText('Repetições mín.')).toBeVisible();
    expect(screen.queryByLabelText('Duração (min)')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: 'Duração' }));
    expect(screen.queryByLabelText('Repetições mín.')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Duração (min)')).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.saveProtocol).toHaveBeenCalledWith(
        PROTOCOL_ID,
        expect.objectContaining({
          sessions: [
            expect.objectContaining({
              exercises: [expect.objectContaining({ durationSeconds: 600, reps: undefined })],
            }),
          ],
        }),
      ),
    );
  });

  it('exercício por duração: exibe/edita "Duração (min)" em vez de repetições, e "—" quando RIR/vídeo/notas ausentes', async () => {
    const baseProtocol = protocolDetail.protocol;
    if (!baseProtocol) throw new Error('fixture inválida');
    api.getQueueDetail.mockResolvedValue({
      ...protocolDetail,
      protocol: {
        ...baseProtocol,
        content: {
          ...baseProtocol.content,
          sessions: [
            {
              dayLabel: 'Treino B',
              focus: 'Cardio',
              exercises: [
                {
                  exerciseId: 'plank',
                  name: 'Prancha',
                  sets: 3,
                  durationSeconds: 45,
                  loadStrategy: 'BODYWEIGHT',
                  restSeconds: 60,
                },
              ],
            },
          ],
        },
      },
    });
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await screen.findByRole('heading', { name: /Protocolo · versão 1/i });

    expect(screen.getByText('45 s')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Assistir' })).not.toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('—')).toHaveLength(3); // RIR, técnica e vídeo ausentes

    await userEvent.click(screen.getByRole('button', { name: 'Editar Protocolo' }));
    expect(screen.queryByLabelText('Repetições mín.')).not.toBeInTheDocument();
    // Segundos guardados (45 s = 0,75 min) aparecem em minutos no campo.
    const duration = screen.getByLabelText('Duração (min)');
    expect(duration).toHaveValue(0.75);
    await userEvent.clear(duration);
    await userEvent.type(duration, '1.5');

    api.saveProtocol.mockResolvedValue({ status: 'PENDING_REVIEW' });
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.saveProtocol).toHaveBeenCalledWith(
        PROTOCOL_ID,
        expect.objectContaining({
          sessions: [
            expect.objectContaining({
              exercises: [expect.objectContaining({ durationSeconds: 90 })],
            }),
          ],
        }),
      ),
    );
  });

  it('bloqueia salvar quando a edição deixa o protocolo inválido, mostrando as mensagens do schema', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Protocolo' }));
    // Apagar o exercício no autocomplete sem escolher outro deixa o item sem seleção do
    // catálogo — o editor não salva texto que não virou exercício oficial.
    await userEvent.clear(screen.getByLabelText('Exercício do catálogo'));
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('precisa de revisão');
    expect(api.saveProtocol).not.toHaveBeenCalled();
  });

  it('mostra as mensagens de erro do servidor ao salvar em cada formato possível', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Protocolo' }));

    const arrayError = new DashboardApiError(502, 'mensagem', ['Erro de validação 1']);
    api.saveProtocol.mockRejectedValueOnce(arrayError);
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Erro de validação 1');

    const issuesError = new DashboardApiError(502, 'mensagem', { issues: ['Campo obrigatório'] });
    api.saveProtocol.mockRejectedValueOnce(issuesError);
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Campo obrigatório');

    api.saveProtocol.mockRejectedValueOnce(new Error('Falha de rede'));
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha de rede');

    api.saveProtocol.mockRejectedValueOnce('erro-desconhecido');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível salvar o protocolo.',
    );
  });

  it('protocolo assinado mostra o hash e a data (ou "data não informada" quando ausente)', async () => {
    const baseProtocol = protocolDetail.protocol;
    if (!baseProtocol) throw new Error('fixture inválida');
    api.getQueueDetail.mockResolvedValueOnce({
      ...protocolDetail,
      protocol: { ...baseProtocol, signatureHash: 'abc123', signedAt: '2026-08-10T10:00:00.000Z' },
    });
    const { unmount } = render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    expect(await screen.findByText(/hash/)).toHaveTextContent('abc123');
    expect(screen.queryByRole('button', { name: 'Assinar e liberar' })).not.toBeInTheDocument();
    unmount();

    api.getQueueDetail.mockResolvedValueOnce({
      ...protocolDetail,
      protocol: { ...baseProtocol, signatureHash: 'def456', signedAt: null },
    });
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    expect(await screen.findByText(/data não informada/)).toBeVisible();
  });

  it('rótulos desconhecidos de fase/dia caem pro valor cru, sem quebrar a tela', async () => {
    const baseProtocol = protocolDetail.protocol;
    const baseSession = baseProtocol?.content.sessions[0];
    if (!baseProtocol || !baseSession) throw new Error('fixture inválida');
    api.getQueueDetail.mockResolvedValue({
      ...protocolDetail,
      protocol: {
        ...baseProtocol,
        content: {
          ...baseProtocol.content,
          phase: 'DESCONHECIDA' as never,
          sessions: [{ ...baseSession, weekday: 'XXX' as never }],
        },
      },
    });
    api.getAnamnesisAnswers.mockResolvedValue({
      ...anamnesisAnswers,
      routine: { ...anamnesisAnswers.routine, preferredDays: ['ZZZ'] },
    });
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    expect(await screen.findByText('XXX | Membros inferiores | DESCONHECIDA')).toBeVisible();
    expect(await screen.findByText(/ZZZ/)).toBeVisible();
    expect(screen.getAllByText(/DESCONHECIDA/).length).toBeGreaterThan(0);
  });
});

/**
 * Achado 2026-10-15 (produção): o RT digitou "Abdominal na Prancha" à mão, o item virou
 * `manual-<uuid>` e a assinatura recusou. Exercício só entra pelo catálogo oficial, e a
 * prescrição do profissional passa a prevalecer sobre as regras automáticas, com decisão
 * explícita na assinatura.
 */
describe('QueueDetail — prescrição manual do profissional', () => {
  const base = protocolDetail.protocol;
  if (!base) throw new Error('fixture sem protocolo');
  const PLANK_CONFLICT = {
    key: 'EXERCISE_CONTRAINDICATED:prancha contraindicado por LOWER_BACK',
    rule: 'EXERCISE_CONTRAINDICATED',
    detail: 'prancha contraindicado por LOWER_BACK',
  };
  const withProtocol = (over: Record<string, unknown>) => ({
    ...protocolDetail,
    protocol: { ...base, ...over },
  });

  it('exercício novo não salva sem seleção do catálogo; selecionado, salva com o id oficial', async () => {
    api.getQueueDetail.mockResolvedValue(protocolDetail);
    api.saveProtocol.mockResolvedValue({ status: 'PENDING_SIGNATURE' });
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Protocolo' }));
    await userEvent.click(screen.getByRole('button', { name: /adicionar exercício/i }));

    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Selecione no catálogo');
    expect(api.saveProtocol).not.toHaveBeenCalled();

    const pickers = screen.getAllByLabelText('Exercício do catálogo');
    await pickFromCatalog(pickers[1] as HTMLElement, 'supino');
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    await waitFor(() => expect(api.saveProtocol).toHaveBeenCalledOnce());
    const saved = api.saveProtocol.mock.calls[0]?.[1] as {
      sessions: Array<{ exercises: Array<{ exerciseId: string }> }>;
    };
    expect(saved.sessions[0]?.exercises.map((exercise) => exercise.exerciseId)).toEqual([
      'goblet_squat',
      'supino_reto_halter',
    ]);
  });

  it('item legado fora do catálogo (manual-) é sinalizado e só salva depois de escolher um oficial', async () => {
    const session = base.content.sessions[0];
    if (!session) throw new Error('fixture');
    api.getQueueDetail.mockResolvedValue(
      withProtocol({
        content: {
          ...base.content,
          sessions: [
            {
              ...session,
              exercises: [
                {
                  ...session.exercises[0],
                  exerciseId: 'manual-c8b975ba-22a7-4f29-933a-ef7d34427983',
                  name: 'Abdominal na Prancha',
                },
              ],
            },
          ],
        },
      }),
    );
    api.saveProtocol.mockResolvedValue({ status: 'PENDING_SIGNATURE' });
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Protocolo' }));
    expect(screen.getByText(/Exercício fora do catálogo/)).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('hoje "Abdominal na Prancha"');
    expect(api.saveProtocol).not.toHaveBeenCalled();

    await pickFromCatalog(screen.getByLabelText('Exercício do catálogo'), 'prancha', {
      ...SUPINO,
      id: 'prancha',
      name: 'Prancha',
      pattern: 'CORE',
      measurement: 'DURATION',
      contraindicatedForStudent: ['LOWER_BACK'],
    });
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    await waitFor(() =>
      expect(api.saveProtocol).toHaveBeenCalledWith(
        PROTOCOL_ID,
        expect.objectContaining({
          sessions: [
            expect.objectContaining({
              exercises: [
                // Exercício por tempo no catálogo: a seleção troca repetições por duração.
                expect.objectContaining({
                  exerciseId: 'prancha',
                  name: 'Prancha',
                  durationSeconds: 30,
                  reps: undefined,
                }),
              ],
            }),
          ],
        }),
      ),
    );
  });

  it('assinatura de prescrição com divergência exige marcar a decisão e envia as chaves reconhecidas', async () => {
    api.getQueueDetail.mockResolvedValue(
      withProtocol({
        review: {
          origin: 'PROFESSIONAL',
          availability: { daysPerWeek: 3, preferredDays: [] },
          blocking: [],
          conflicts: [PLANK_CONFLICT],
        },
      }),
    );
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    expect(
      await screen.findByText('Prescrição sua com divergências das regras automáticas'),
    ).toBeVisible();

    await userEvent.click(screen.getByRole('button', { name: 'Assinar e liberar' }));
    const confirm = screen.getByRole('button', { name: 'Confirmar e assinar' });
    expect(confirm).toBeDisabled();
    await userEvent.click(
      screen.getByRole('checkbox', { name: /mantenho esta prescrição como decisão profissional/i }),
    );
    expect(confirm).not.toBeDisabled();
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(api.signProtocol).toHaveBeenCalledWith(PROTOCOL_ID, [PLANK_CONFLICT.key]),
    );
  });

  it('pendência de integridade apontada pelo servidor impede assinar', async () => {
    api.getQueueDetail.mockResolvedValue(
      withProtocol({
        review: {
          origin: 'AI',
          availability: { daysPerWeek: 4, preferredDays: ['MON', 'WED', 'THU', 'SAT', 'SUN'] },
          blocking: [
            {
              key: 'WEEKLY_SESSIONS_EXCEED_AVAILABILITY:x',
              rule: 'WEEKLY_SESSIONS_EXCEED_AVAILABILITY',
              detail: '5 sessões por semana, acima dos 4 dias disponíveis do aluno',
            },
          ],
          conflicts: [],
        },
      }),
    );
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    expect(await screen.findByText('Corrija antes de assinar ou publicar:')).toBeVisible();
    expect(
      screen.getByText(/Mais sessões que os dias disponíveis do aluno: 5 sessões por semana/),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Assinar e liberar' })).toBeDisabled();
    expect(screen.getByText(/Disponibilidade do aluno:/).closest('p')).toHaveTextContent(
      '4 dia(s) por semana · prefere Segunda, Quarta, Quinta, Sábado, Domingo',
    );
  });

  it('detalhe do aluno (protocolo ativo): divergência devolvida na publicação vira decisão explícita', async () => {
    api.getQueueDetail.mockResolvedValue(
      withProtocol({
        status: 'ACTIVE',
        approvalStatus: 'HUMAN_APPROVED',
        signedAt: '2026-10-12T12:00:00.000Z',
        signatureHash: 'a'.repeat(64),
      }),
    );
    api.amendActiveProtocol
      .mockRejectedValueOnce(
        new DashboardApiError(
          400,
          'A prescrição diverge das regras automáticas.',
          undefined,
          'PROFESSIONAL_DECISION_REQUIRED',
          [PLANK_CONFLICT],
        ),
      )
      .mockResolvedValueOnce({ status: 'ACTIVE' });
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Protocolo' }));
    await userEvent.type(screen.getByLabelText('Motivo da atualização'), 'Core avaliado');
    const publish = screen.getByRole('button', { name: 'Salvar e publicar atualização' });
    await userEvent.click(publish);

    expect(await screen.findByText('Divergências das regras automáticas')).toBeVisible();
    await userEvent.click(publish);
    expect(await screen.findByRole('alert')).toHaveTextContent('Confirme as divergências');
    expect(api.amendActiveProtocol).toHaveBeenCalledTimes(1);

    await userEvent.click(
      screen.getByRole('checkbox', { name: /mantenho esta prescrição como decisão profissional/i }),
    );
    await userEvent.click(publish);
    await waitFor(() => expect(api.amendActiveProtocol).toHaveBeenCalledTimes(2));
    expect(api.amendActiveProtocol).toHaveBeenLastCalledWith(
      PROTOCOL_ID,
      expect.objectContaining({ acknowledgedConflicts: [PLANK_CONFLICT.key] }),
    );
  });

  it('sessões com dia fixo: frequência acompanha o número de sessões e nunca passa da disponibilidade', async () => {
    const session = base.content.sessions[0];
    if (!session) throw new Error('fixture');
    api.getQueueDetail.mockResolvedValue(
      withProtocol({
        content: {
          ...base.content,
          weeklyFrequency: 2,
          sessions: [
            { ...session, weekday: 'MON' },
            { ...session, dayLabel: 'Treino B', weekday: 'WED' },
          ],
        },
        review: {
          origin: 'AI',
          availability: { daysPerWeek: 2, preferredDays: ['MON', 'WED'] },
          blocking: [],
          conflicts: [],
        },
      }),
    );
    api.saveProtocol.mockResolvedValue({ status: 'PENDING_SIGNATURE' });
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Protocolo' }));

    // Já há uma sessão por dia disponível: não dá para acrescentar outra.
    expect(screen.getByRole('button', { name: 'Adicionar sessão' })).toBeDisabled();
    expect(screen.getByText(/Frequência semanal:/)).toHaveTextContent('2x');

    // Remove a segunda sessão e muda o dia da primeira.
    await userEvent.click(
      screen.getAllByRole('button', { name: /remover sessão/i })[1] as HTMLElement,
    );
    await userEvent.click(screen.getByRole('combobox', { name: 'Dia da semana' }));
    await userEvent.click(screen.getByRole('option', { name: 'Sexta' }));
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));

    await waitFor(() =>
      expect(api.saveProtocol).toHaveBeenCalledWith(
        PROTOCOL_ID,
        expect.objectContaining({
          weeklyFrequency: 1,
          sessions: [expect.objectContaining({ weekday: 'FRI' })],
        }),
      ),
    );
  });

  it('não salva com dia da semana definido só em parte das sessões', async () => {
    const session = base.content.sessions[0];
    if (!session) throw new Error('fixture');
    api.getQueueDetail.mockResolvedValue(
      withProtocol({
        content: {
          ...base.content,
          weeklyFrequency: 2,
          sessions: [session, { ...session, dayLabel: 'Treino B' }],
        },
      }),
    );
    render(<QueueDetail kind="PROTOCOL" id={PROTOCOL_ID} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Editar Protocolo' }));
    await userEvent.click(
      screen.getAllByRole('combobox', { name: 'Dia da semana' })[0] as HTMLElement,
    );
    await userEvent.click(screen.getByRole('option', { name: 'Segunda' }));
    await userEvent.click(screen.getByRole('button', { name: /salvar/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Defina o dia da semana de todas as sessões.',
    );
    expect(api.saveProtocol).not.toHaveBeenCalled();
  });
});

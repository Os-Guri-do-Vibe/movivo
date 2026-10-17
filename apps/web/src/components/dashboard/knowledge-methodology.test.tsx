import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

const {
  createMethodologyVersion,
  getMethodology,
  publishMethodologyVersion,
  reviewMethodologyVersion,
  rollbackMethodologyVersion,
  submitMethodologyVersion,
} = vi.hoisted(() => ({
  createMethodologyVersion: vi.fn(),
  getMethodology: vi.fn(),
  publishMethodologyVersion: vi.fn(),
  reviewMethodologyVersion: vi.fn(),
  rollbackMethodologyVersion: vi.fn(),
  submitMethodologyVersion: vi.fn(),
}));

vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  createMethodologyVersion,
  getMethodology,
  publishMethodologyVersion,
  reviewMethodologyVersion,
  rollbackMethodologyVersion,
  submitMethodologyVersion,
}));

import { ControlCenterApiError } from '@/lib/control-center-api';

import { KnowledgeMethodologyPanel } from './knowledge-methodology';

const CONTENT = `${'Diretriz metodológica validada pelo profissional CREF. '.repeat(6)}\nProgressão conservadora e revisão humana.`;
const meta = {
  generatedAt: '2026-08-20T12:00:00.000Z',
  timezone: 'America/Sao_Paulo' as const,
  dataQuality: [],
};
const response = {
  data: {
    versions: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        version: 1,
        status: 'PUBLISHED' as const,
        content: CONTENT,
        sha256: 'a'.repeat(64),
        changeNote: 'Versão inicial migrada.',
        createdBy: 'Rodrigo',
        reviewedBy: 'Profissional CREF',
        createdAt: '2026-08-18T12:00:00.000Z',
        reviewedAt: '2026-08-18T13:00:00.000Z',
        publishedAt: '2026-08-18T14:00:00.000Z',
        statusChangedAt: '2026-08-18T14:00:00.000Z',
        current: true,
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        version: 2,
        status: 'DRAFT' as const,
        content: `${CONTENT}\nRascunho.`,
        sha256: 'b'.repeat(64),
        changeNote: 'Inclui nova progressão.',
        createdBy: 'Admin',
        reviewedBy: null,
        createdAt: '2026-08-19T12:00:00.000Z',
        reviewedAt: null,
        publishedAt: null,
        statusChangedAt: '2026-08-19T12:00:00.000Z',
        current: false,
      },
      {
        id: '33333333-3333-4333-8333-333333333333',
        version: 3,
        status: 'IN_REVIEW' as const,
        content: `${CONTENT}\nEm revisão.`,
        sha256: 'c'.repeat(64),
        changeNote: 'Ajusta deload programado.',
        createdBy: 'Admin',
        reviewedBy: null,
        createdAt: '2026-08-20T10:00:00.000Z',
        reviewedAt: null,
        publishedAt: null,
        statusChangedAt: '2026-08-20T11:00:00.000Z',
        current: false,
      },
      {
        id: '44444444-4444-4444-8444-444444444444',
        version: 4,
        status: 'APPROVED' as const,
        content: `${CONTENT}\nAprovada.`,
        sha256: 'd'.repeat(64),
        changeNote: 'Parecer CREF concluído.',
        createdBy: 'Admin',
        reviewedBy: 'Profissional CREF',
        createdAt: '2026-08-20T09:00:00.000Z',
        reviewedAt: '2026-08-20T11:30:00.000Z',
        publishedAt: null,
        statusChangedAt: '2026-08-20T11:30:00.000Z',
        current: false,
      },
      {
        id: '55555555-5555-4555-8555-555555555555',
        version: 0,
        status: 'ARCHIVED' as const,
        content: `${CONTENT}\nArquivada.`,
        sha256: 'e'.repeat(64),
        changeNote: 'Versão anterior.',
        createdBy: 'Admin',
        reviewedBy: 'Profissional CREF',
        createdAt: '2026-08-17T09:00:00.000Z',
        reviewedAt: '2026-08-17T10:00:00.000Z',
        publishedAt: '2026-08-17T11:00:00.000Z',
        statusChangedAt: '2026-08-18T14:00:00.000Z',
        current: false,
      },
    ],
  },
  meta,
};

beforeEach(() => {
  getMethodology.mockReset().mockResolvedValue(response);
  for (const mutation of [
    createMethodologyVersion,
    publishMethodologyVersion,
    reviewMethodologyVersion,
    rollbackMethodologyVersion,
    submitMethodologyVersion,
  ]) {
    mutation.mockReset().mockResolvedValue(response);
  }
});

const DRAFT_FIXTURE = response.data.versions[1] as (typeof response.data.versions)[number];

function withPublished(id: string) {
  return {
    ...response,
    data: {
      versions: response.data.versions.map((version) => ({
        ...version,
        current: version.id === id,
        status:
          version.id === id
            ? ('PUBLISHED' as const)
            : version.status === 'PUBLISHED'
              ? ('ARCHIVED' as const)
              : version.status,
      })),
    },
  };
}

const V4 = '44444444-4444-4444-8444-444444444444';
const V3 = '33333333-3333-4333-8333-333333333333';
const V2 = '22222222-2222-4222-8222-222222222222';
const V0 = '55555555-5555-4555-8555-555555555555';

describe('KnowledgeMethodologyPanel', () => {
  it('mostra a versão em vigor sem criar outro h1', async () => {
    render(<KnowledgeMethodologyPanel />);
    expect(
      await screen.findByRole('heading', { name: 'Metodologia oficial', level: 2 }),
    ).toBeVisible();
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(screen.getByText('Em vigor agora')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'v1', level: 3 })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Nova versão/ })).not.toBeInTheDocument();
  });

  it('destaca a versão aguardando publicação e quanto ela muda em relação à vigente', async () => {
    render(<KnowledgeMethodologyPanel canEdit canApprove />);
    const banner = await screen.findByRole('region', { name: 'Versão aguardando publicação' });
    expect(within(banner).getByRole('heading', { name: 'v4' })).toBeVisible();
    expect(within(banner).getByText('1 linhas adicionadas')).toBeInTheDocument();
    expect(within(banner).getByText(/em relação à v1/)).toBeVisible();
  });

  it('publica com um clique, sem pedir justificativa', async () => {
    const user = userEvent.setup();
    publishMethodologyVersion.mockResolvedValue(withPublished(V4));
    render(<KnowledgeMethodologyPanel canEdit canApprove />);

    const banner = await screen.findByRole('region', { name: 'Versão aguardando publicação' });
    await user.click(within(banner).getByRole('button', { name: 'Publicar v4' }));

    await waitFor(() => expect(publishMethodologyVersion).toHaveBeenCalledWith(V4));
    expect(screen.queryByLabelText(/Justificativa/)).not.toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('A v4 foi publicada');
    expect(screen.getByRole('heading', { name: 'v4', level: 3 })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Versão aguardando publicação' })).toBeNull();
  });

  it('publica direto de um rascunho (sem passar por revisão)', async () => {
    const user = userEvent.setup();
    publishMethodologyVersion.mockResolvedValue(withPublished(V2));
    render(<KnowledgeMethodologyPanel canEdit canApprove />);

    const draft = await screen.findByRole('article', { name: 'Versão 2' });
    await user.click(within(draft).getByRole('button', { name: 'Publicar' }));
    await waitFor(() => expect(publishMethodologyVersion).toHaveBeenCalledWith(V2));
    expect(reviewMethodologyVersion).not.toHaveBeenCalled();
  });

  it('quem não tem permissão de publicar não vê o botão', async () => {
    render(<KnowledgeMethodologyPanel canEdit />);
    const banner = await screen.findByRole('region', { name: 'Versão aguardando publicação' });
    expect(within(banner).queryByRole('button', { name: /Publicar/ })).not.toBeInTheDocument();
    expect(within(banner).getByText(/permissão de publicação/)).toBeVisible();
  });

  it('salva um rascunho sem exigir resumo e avisa que a IA não foi afetada', async () => {
    const user = userEvent.setup();
    render(<KnowledgeMethodologyPanel canEdit canApprove />);
    await user.click(await screen.findByRole('button', { name: /Nova versão/ }));
    await user.type(screen.getByLabelText('Conteúdo metodológico'), '\nNova diretriz de deload.');
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));

    await waitFor(() =>
      expect(createMethodologyVersion).toHaveBeenCalledWith({
        content: `${CONTENT}\nNova diretriz de deload.`,
        changeNote: undefined,
      }),
    );
    expect(publishMethodologyVersion).not.toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent('ainda não afeta a IA');
  });

  it('Salvar e publicar cria a versão e já a coloca em vigor', async () => {
    const user = userEvent.setup();
    const NEW_CONTENT = `${CONTENT}\nNova diretriz de deload.`;
    const created = {
      ...response,
      data: {
        versions: [
          ...response.data.versions,
          {
            ...DRAFT_FIXTURE,
            id: '66666666-6666-4666-8666-666666666666',
            version: 5,
            content: NEW_CONTENT,
            changeNote: 'Inclui deload.',
          },
        ],
      },
    };
    createMethodologyVersion.mockResolvedValue(created);
    publishMethodologyVersion.mockResolvedValue(
      withPublished('66666666-6666-4666-8666-666666666666'),
    );

    render(<KnowledgeMethodologyPanel canEdit canApprove />);
    await user.click(await screen.findByRole('button', { name: /Nova versão/ }));
    await user.type(screen.getByLabelText('Conteúdo metodológico'), '\nNova diretriz de deload.');
    await user.type(screen.getByLabelText(/Resumo da alteração/), 'Inclui deload.');
    await user.click(screen.getByRole('button', { name: 'Salvar e publicar' }));

    await waitFor(() =>
      expect(publishMethodologyVersion).toHaveBeenCalledWith(
        '66666666-6666-4666-8666-666666666666',
      ),
    );
    expect(createMethodologyVersion).toHaveBeenCalledWith({
      content: NEW_CONTENT,
      changeNote: 'Inclui deload.',
    });
    expect(await screen.findByRole('status')).toHaveTextContent('foi salva e publicada');
  });

  it('não oferece "Salvar e publicar" a quem não pode publicar', async () => {
    const user = userEvent.setup();
    render(<KnowledgeMethodologyPanel canEdit />);
    await user.click(await screen.findByRole('button', { name: /Nova versão/ }));
    expect(screen.queryByRole('button', { name: 'Salvar e publicar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeInTheDocument();
  });

  it('bloqueia o salvamento enquanto não há alteração em relação à vigente', async () => {
    const user = userEvent.setup();
    render(<KnowledgeMethodologyPanel canEdit canApprove />);
    await user.click(await screen.findByRole('button', { name: /Nova versão/ }));
    expect(screen.getByRole('button', { name: 'Salvar rascunho' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('nenhuma alteração');
  });

  it('mostra o erro devolvido ao salvar em vez de falhar em silêncio', async () => {
    const user = userEvent.setup();
    createMethodologyVersion.mockRejectedValueOnce(
      new ControlCenterApiError(409, 'Esta metodologia já possui uma versão.'),
    );
    render(<KnowledgeMethodologyPanel canEdit />);
    await user.click(await screen.findByRole('button', { name: /Nova versão/ }));
    await user.type(screen.getByLabelText('Conteúdo metodológico'), ' Extra.');
    await user.click(screen.getByRole('button', { name: 'Salvar rascunho' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('já possui uma versão');
  });

  it('o editor mostra o que entrou em verde e o que saiu em vermelho', async () => {
    const user = userEvent.setup();
    render(<KnowledgeMethodologyPanel canEdit canApprove />);
    await user.click(await screen.findByRole('button', { name: /Nova versão/ }));
    await user.type(screen.getByLabelText('Conteúdo metodológico'), '\nLinha nova.');
    await user.click(screen.getByRole('tab', { name: /Ver mudanças/ }));
    expect(await screen.findByText('Adicionada:')).toBeInTheDocument();
    expect(screen.getByText(/Linha nova\./)).toBeVisible();
  });

  it('compara qualquer versão com a anterior em um diálogo', async () => {
    const user = userEvent.setup();
    render(<KnowledgeMethodologyPanel />);
    const draft = await screen.findByRole('article', { name: 'Versão 2' });
    await user.click(within(draft).getByRole('button', { name: 'Comparar' }));

    const dialog = await screen.findByRole('dialog', { name: 'Comparar versões' });
    expect(within(dialog).getByLabelText('Versão base')).toHaveValue(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(within(dialog).getByLabelText('Versão nova')).toHaveValue(V2);
    expect(within(dialog).getByText('1 linhas adicionadas')).toBeInTheDocument();
    expect(within(dialog).getByText('0 linhas removidas')).toBeInTheDocument();
  });

  it('inverter a comparação troca o que é adicionado e removido', async () => {
    const user = userEvent.setup();
    render(<KnowledgeMethodologyPanel />);
    const draft = await screen.findByRole('article', { name: 'Versão 2' });
    await user.click(within(draft).getByRole('button', { name: 'Comparar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Comparar versões' });
    await user.click(within(dialog).getByRole('button', { name: 'Inverter a comparação' }));
    expect(within(dialog).getByText('1 linhas removidas')).toBeInTheDocument();
    expect(within(dialog).getByText('0 linhas adicionadas')).toBeInTheDocument();
  });

  it('restaura uma versão arquivada e já a publica para quem pode', async () => {
    const user = userEvent.setup();
    const restored = {
      ...response,
      data: {
        versions: [
          ...response.data.versions,
          {
            ...DRAFT_FIXTURE,
            id: '77777777-7777-4777-8777-777777777777',
            version: 6,
            content: `${CONTENT}\nArquivada.`,
          },
        ],
      },
    };
    rollbackMethodologyVersion.mockResolvedValue(restored);
    publishMethodologyVersion.mockResolvedValue(
      withPublished('77777777-7777-4777-8777-777777777777'),
    );
    render(<KnowledgeMethodologyPanel canEdit canApprove />);

    const archived = await screen.findByRole('article', { name: 'Versão 0' });
    await user.click(within(archived).getByRole('button', { name: 'Restaurar e publicar' }));

    await waitFor(() => expect(rollbackMethodologyVersion).toHaveBeenCalledWith(V0));
    await waitFor(() =>
      expect(publishMethodologyVersion).toHaveBeenCalledWith(
        '77777777-7777-4777-8777-777777777777',
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('voltou a valer');
  });

  it('restaurar sem poder publicar deixa só um rascunho', async () => {
    const user = userEvent.setup();
    render(<KnowledgeMethodologyPanel canEdit />);
    const archived = await screen.findByRole('article', { name: 'Versão 0' });
    await user.click(within(archived).getByRole('button', { name: 'Restaurar' }));
    await waitFor(() => expect(rollbackMethodologyVersion).toHaveBeenCalledWith(V0));
    expect(publishMethodologyVersion).not.toHaveBeenCalled();
  });

  it('o parecer de quem só aprova continua exigindo justificativa', async () => {
    const user = userEvent.setup();
    render(<KnowledgeMethodologyPanel canApprove />);

    const inReview = await screen.findByRole('article', { name: 'Versão 3' });
    await user.click(within(inReview).getByRole('button', { name: 'Aprovar' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Aprovar versão' })).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText('Justificativa do parecer'),
      'Parecer técnico favorável.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Aprovar versão' }));
    await waitFor(() =>
      expect(reviewMethodologyVersion).toHaveBeenCalledWith(V3, {
        decision: 'APPROVED',
        note: 'Parecer técnico favorável.',
      }),
    );
  });

  it('sem versão publicada, convida a escrever a primeira', async () => {
    getMethodology.mockResolvedValue({ ...response, data: { versions: [] } });
    render(<KnowledgeMethodologyPanel canEdit />);
    expect(await screen.findByText('Nenhuma metodologia em vigor')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Escrever metodologia' })).toBeVisible();
  });
});

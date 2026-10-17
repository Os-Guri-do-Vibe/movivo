import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ControlCenterApi from '@/lib/control-center-api';

const {
  deleteKnowledgeDocument,
  getKnowledgeDocumentContent,
  getKnowledgeDocuments,
  retryKnowledgeDocument,
  reviewKnowledgeDocument,
  uploadKnowledgeArticle,
} = vi.hoisted(() => ({
  deleteKnowledgeDocument: vi.fn(),
  getKnowledgeDocumentContent: vi.fn(),
  getKnowledgeDocuments: vi.fn(),
  retryKnowledgeDocument: vi.fn(),
  reviewKnowledgeDocument: vi.fn(),
  uploadKnowledgeArticle: vi.fn(),
}));

vi.mock('@/lib/control-center-api', async (importOriginal) => ({
  ...(await importOriginal<typeof ControlCenterApi>()),
  deleteKnowledgeDocument,
  getKnowledgeDocumentContent,
  getKnowledgeDocuments,
  retryKnowledgeDocument,
  reviewKnowledgeDocument,
  uploadKnowledgeArticle,
}));

import { ControlCenterApiError } from '@/lib/control-center-api';

import { KnowledgeArticlesPanel } from './knowledge-articles';

const meta = {
  generatedAt: '2026-10-17T12:00:00.000Z',
  timezone: 'America/Sao_Paulo' as const,
  dataQuality: [],
};

function doc(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    title: `Artigo ${id.slice(0, 1)}`,
    topic: 'evidência científica',
    sourceUrl: null,
    originalFilename: `artigo-${id.slice(0, 1)}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 2 * 1024 * 1024,
    sha256: 'a'.repeat(64),
    status: 'PUBLISHED' as const,
    stage: 'PUBLISHED',
    errorCode: null,
    canRetry: false,
    uploadedBy: 'Rodrigo',
    reviewer: null,
    reviewNote: null,
    createdAt: '2026-10-16T12:00:00.000Z',
    reviewedAt: null,
    retainedUntil: null,
    blobAvailable: true,
    chunkCount: 12,
    ...over,
  };
}

const ID = {
  pdf: '1aaaaaaa-1111-4111-8111-111111111111',
  docx: '2bbbbbbb-2222-4222-8222-222222222222',
  scanned: '3ccccccc-3333-4333-8333-333333333333',
  transient: '4ddddddd-4444-4444-8444-444444444444',
  gone: '5eeeeeee-5555-4555-8555-555555555555',
  legacy: '6fffffff-6666-4666-8666-666666666666',
};

function response(documents: unknown[]) {
  return {
    data: {
      documents,
      policy: {
        allowedTypes: ['application/pdf'],
        allowedExtensions: ['.pdf', '.docx', '.xlsx', '.csv', '.md', '.txt'],
        maxBytes: 10 * 1024 * 1024,
        quarantineDays: 30,
        approvedOriginalDays: 365,
      },
    },
    meta,
  };
}

const base = response([
  doc(ID.pdf, { title: 'Volume e hipertrofia' }),
  doc(ID.docx, {
    title: 'Revisão sistemática',
    originalFilename: 'revisao.docx',
    status: 'INDEXING',
    stage: 'INDEXING',
    createdAt: '2026-10-16T13:00:00.000Z',
    chunkCount: 0,
  }),
  doc(ID.scanned, {
    title: 'PDF escaneado',
    status: 'FAILED',
    stage: 'INGESTION',
    errorCode: 'NO_TEXT_LAYER',
    canRetry: true,
    createdAt: '2026-10-16T14:00:00.000Z',
  }),
  doc(ID.transient, {
    title: 'Falha de fila',
    status: 'FAILED',
    stage: 'INGESTION',
    errorCode: 'QUEUE_UNAVAILABLE',
    canRetry: true,
    createdAt: '2026-10-16T15:00:00.000Z',
  }),
  doc(ID.gone, { title: 'Já excluído', status: 'ARCHIVED', stage: 'DELETED' }),
]);

beforeEach(() => {
  getKnowledgeDocuments.mockReset().mockResolvedValue(base);
  getKnowledgeDocumentContent
    .mockReset()
    .mockResolvedValue({ data: { id: ID.pdf, content: 'texto extraído do artigo' }, meta });
  deleteKnowledgeDocument.mockReset().mockResolvedValue(response([]));
  retryKnowledgeDocument.mockReset().mockResolvedValue(base);
  reviewKnowledgeDocument.mockReset().mockResolvedValue(base);
  uploadKnowledgeArticle.mockReset().mockResolvedValue(base);
});

afterEach(() => vi.useRealTimers());

function pdf(name = 'estudo.pdf', size = 1024) {
  return new File([new Uint8Array(size)], name, { type: 'application/pdf' });
}

describe('KnowledgeArticlesPanel · explorador', () => {
  it('lista os artigos ativos com ícone de documento e esconde os excluídos', async () => {
    render(<KnowledgeArticlesPanel canUpload canApprove />);
    expect(await screen.findByRole('heading', { name: 'Artigos científicos' })).toBeVisible();
    expect(screen.getByRole('button', { name: /Volume e hipertrofia/ })).toBeVisible();
    expect(screen.getByRole('button', { name: /Revisão sistemática/ })).toBeVisible();
    expect(screen.queryByText('Já excluído')).not.toBeInTheDocument();
    expect(screen.getByText('(4)')).toBeInTheDocument();
    expect(screen.getAllByText('Ativo').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Processando').length).toBeGreaterThan(0);
  });

  it('a lixeira só aparece depois de clicar no artigo', async () => {
    const user = userEvent.setup();
    render(<KnowledgeArticlesPanel canUpload />);
    const tile = await screen.findByRole('button', { name: /Volume e hipertrofia/ });
    expect(screen.queryByRole('button', { name: 'Excluir Volume e hipertrofia' })).toBeNull();

    await user.click(tile);
    expect(tile).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Excluir Volume e hipertrofia' })).toBeVisible();

    await user.click(tile);
    expect(screen.queryByRole('button', { name: 'Excluir Volume e hipertrofia' })).toBeNull();
  });

  it('exclui sem pedir justificativa, só com uma confirmação', async () => {
    const user = userEvent.setup();
    render(<KnowledgeArticlesPanel canUpload />);
    await user.click(await screen.findByRole('button', { name: /Volume e hipertrofia/ }));
    await user.click(screen.getByRole('button', { name: 'Excluir Volume e hipertrofia' }));

    const dialog = await screen.findByRole('dialog', { name: 'Excluir este artigo?' });
    expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Excluir definitivamente' }));

    await waitFor(() => expect(deleteKnowledgeDocument).toHaveBeenCalledWith(ID.pdf));
    expect(await screen.findByRole('status')).toHaveTextContent('excluído definitivamente');
    expect(screen.queryByRole('button', { name: /Volume e hipertrofia/ })).toBeNull();
  });

  it('arquivados e rejeitados antigos ficam ocultos, mas podem ser mostrados e excluídos', async () => {
    const user = userEvent.setup();
    render(<KnowledgeArticlesPanel canUpload />);
    await screen.findByRole('button', { name: /Volume e hipertrofia/ });
    expect(screen.queryByRole('button', { name: /Já excluído/ })).toBeNull();

    await user.click(
      screen.getByRole('checkbox', { name: /Mostrar arquivados e rejeitados \(1\)/ }),
    );
    const legacy = screen.getByRole('button', { name: /Já excluído/ });
    expect(within(legacy).getByText('Arquivado')).toBeVisible();
    await user.click(legacy);
    expect(screen.getByRole('button', { name: 'Excluir Já excluído' })).toBeVisible();
  });

  it('cancelar a exclusão não chama a API', async () => {
    const user = userEvent.setup();
    render(<KnowledgeArticlesPanel canUpload />);
    await user.click(await screen.findByRole('button', { name: /Volume e hipertrofia/ }));
    await user.click(screen.getByRole('button', { name: 'Excluir Volume e hipertrofia' }));
    await user.click(await screen.findByRole('button', { name: 'Cancelar' }));
    expect(deleteKnowledgeDocument).not.toHaveBeenCalled();
  });

  it('leitor sem permissão vê os artigos, mas não envia nem exclui', async () => {
    const user = userEvent.setup();
    render(<KnowledgeArticlesPanel />);
    await user.click(await screen.findByRole('button', { name: /Volume e hipertrofia/ }));
    expect(screen.queryByRole('button', { name: /Excluir/ })).toBeNull();
    expect(screen.queryByText('Escolher arquivos')).toBeNull();
  });

  it('falha definitiva explica o motivo e não oferece nova tentativa inútil', async () => {
    const user = userEvent.setup();
    render(<KnowledgeArticlesPanel canUpload />);
    await user.click(await screen.findByRole('button', { name: /PDF escaneado/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('parece escaneado');
    expect(screen.queryByRole('button', { name: 'Tentar novamente' })).toBeNull();
    expect(screen.getAllByRole('button', { name: /Excluir/ }).length).toBeGreaterThan(0);
  });

  it('falha transitória oferece tentar novamente', async () => {
    const user = userEvent.setup();
    render(<KnowledgeArticlesPanel canUpload />);
    await user.click(await screen.findByRole('button', { name: /Falha de fila/ }));
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await waitFor(() => expect(retryKnowledgeDocument).toHaveBeenCalledWith(ID.transient));
  });

  it('lê o texto extraído (só para quem pode revisar)', async () => {
    const user = userEvent.setup();
    render(<KnowledgeArticlesPanel canUpload canApprove />);
    await user.click(await screen.findByRole('button', { name: /Volume e hipertrofia/ }));
    await user.click(screen.getByRole('button', { name: 'Ver texto extraído' }));
    expect(await screen.findByText('texto extraído do artigo')).toBeVisible();
  });

  it('artigo antigo aguardando revisão ganha um Publicar sem justificativa', async () => {
    const user = userEvent.setup();
    getKnowledgeDocuments.mockResolvedValue(
      response([doc(ID.legacy, { title: 'Legado', status: 'READY_FOR_REVIEW', stage: 'REVIEW' })]),
    );
    render(<KnowledgeArticlesPanel canUpload canApprove />);
    await user.click(await screen.findByRole('button', { name: /Legado/ }));
    await user.click(screen.getByRole('button', { name: 'Publicar' }));
    await waitFor(() =>
      expect(reviewKnowledgeDocument).toHaveBeenCalledWith(
        expect.objectContaining({ documentId: ID.legacy, decision: 'APPROVED' }),
      ),
    );
  });

  it('busca filtra por título ou nome do arquivo', async () => {
    const user = userEvent.setup();
    render(<KnowledgeArticlesPanel canUpload />);
    await screen.findByRole('button', { name: /Volume e hipertrofia/ });
    await user.type(screen.getByRole('searchbox', { name: 'Buscar artigo' }), 'revisao.docx');
    expect(screen.getByRole('button', { name: /Revisão sistemática/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Volume e hipertrofia/ })).toBeNull();
  });

  it('alterna entre ícones e lista', async () => {
    const user = userEvent.setup();
    render(<KnowledgeArticlesPanel canUpload />);
    await screen.findByRole('button', { name: /Volume e hipertrofia/ });
    await user.click(screen.getByRole('button', { name: 'Lista' }));
    expect(screen.getByRole('button', { name: 'Lista' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Volume e hipertrofia/ })).toBeVisible();
  });

  it('mostra estado vazio quando não há artigos', async () => {
    getKnowledgeDocuments.mockResolvedValue(response([]));
    render(<KnowledgeArticlesPanel canUpload />);
    expect(await screen.findByText('Nenhum artigo na base ainda')).toBeVisible();
  });

  it('em 403 explica o bloqueio sem oferecer nova tentativa', async () => {
    getKnowledgeDocuments
      .mockReset()
      .mockRejectedValue(new ControlCenterApiError(403, 'Sem acesso ao corpus.'));
    render(<KnowledgeArticlesPanel />);
    expect(
      await screen.findByRole('heading', { name: 'Este setor não faz parte do seu acesso' }),
    ).toBeVisible();
  });

  it('acompanha o processamento sozinho até o artigo ficar ativo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const finished = response([
      doc(ID.docx, { title: 'Revisão sistemática', originalFilename: 'revisao.docx' }),
    ]);
    getKnowledgeDocuments
      .mockReset()
      .mockResolvedValueOnce(
        response([
          doc(ID.docx, {
            title: 'Revisão sistemática',
            originalFilename: 'revisao.docx',
            status: 'INDEXING',
            stage: 'INDEXING',
          }),
        ]),
      )
      .mockResolvedValue(finished);
    render(<KnowledgeArticlesPanel canUpload />);
    expect(await screen.findByText('Processando')).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_500);
    });
    expect(await screen.findByText('Ativo')).toBeVisible();
  });
});

describe('KnowledgeArticlesPanel · upload', () => {
  it('só mostra o botão de salvar depois de escolher arquivos', async () => {
    const user = userEvent.setup();
    render(<KnowledgeArticlesPanel canUpload />);
    await screen.findByText('Escolher arquivos');
    expect(screen.queryByRole('button', { name: /Salvar/ })).toBeNull();

    await user.upload(screen.getByTestId('articles-file-input'), pdf());
    expect(screen.getByText('estudo.pdf')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Salvar artigo' })).toBeEnabled();
  });

  it('salva com um clique, sem metadados, justificativa ou aprovação', async () => {
    const user = userEvent.setup();
    render(<KnowledgeArticlesPanel canUpload />);
    await screen.findByText('Escolher arquivos');
    const file = pdf();
    await user.upload(screen.getByTestId('articles-file-input'), file);
    expect(screen.queryByLabelText(/Título|Tópico|Categoria|Justificativa/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Salvar artigo' }));

    await waitFor(() => expect(uploadKnowledgeArticle).toHaveBeenCalledWith(file));
    expect(await screen.findByRole('status')).toHaveTextContent('Artigo salvo');
    expect(screen.queryByText('estudo.pdf')).toBeNull();
  });

  it('envia vários arquivos de uma vez, um por vez', async () => {
    const user = userEvent.setup();
    render(<KnowledgeArticlesPanel canUpload />);
    await screen.findByText('Escolher arquivos');
    await user.upload(screen.getByTestId('articles-file-input'), [
      pdf('a.pdf'),
      new File(['x'], 'b.docx'),
    ]);
    await user.click(screen.getByRole('button', { name: 'Salvar 2 artigos' }));
    await waitFor(() => expect(uploadKnowledgeArticle).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('status')).toHaveTextContent('2 artigos salvos');
  });

  it.each([
    ['imagem', new File(['x'], 'figura.png', { type: 'image/png' }), 'Formato não aceito'],
    ['arquivo acima do limite', pdf('grande.pdf', 10 * 1024 * 1024 + 1), 'Maior que o limite'],
    ['arquivo vazio', new File([], 'vazio.pdf'), 'está vazio'],
  ])('recusa %s na hora, sem chamar a API', async (_label, file, message) => {
    const user = userEvent.setup({ applyAccept: false });
    render(<KnowledgeArticlesPanel canUpload />);
    await screen.findByText('Escolher arquivos');
    await user.upload(screen.getByTestId('articles-file-input'), file);
    expect(await screen.findByText(new RegExp(message))).toBeVisible();
    expect(screen.queryByRole('button', { name: /Salvar/ })).toBeDisabled();
    expect(uploadKnowledgeArticle).not.toHaveBeenCalled();
  });

  it('mostra o erro de um arquivo e mantém só ele na lista para ajustar', async () => {
    const user = userEvent.setup();
    uploadKnowledgeArticle
      .mockResolvedValueOnce(base)
      .mockRejectedValueOnce(new ControlCenterApiError(409, 'Este artigo já está na base.'));
    render(<KnowledgeArticlesPanel canUpload />);
    await screen.findByText('Escolher arquivos');
    await user.upload(screen.getByTestId('articles-file-input'), [pdf('a.pdf'), pdf('b.pdf')]);
    await user.click(screen.getByRole('button', { name: 'Salvar 2 artigos' }));

    expect(await screen.findByText('Este artigo já está na base.')).toBeVisible();
    expect(screen.queryByText('a.pdf')).toBeNull();
    expect(screen.getByText('b.pdf')).toBeVisible();
  });

  it('remover da lista antes de salvar', async () => {
    const user = userEvent.setup();
    render(<KnowledgeArticlesPanel canUpload />);
    await screen.findByText('Escolher arquivos');
    await user.upload(screen.getByTestId('articles-file-input'), pdf('a.pdf'));
    await user.click(screen.getByRole('button', { name: 'Remover a.pdf da lista' }));
    expect(screen.queryByText('a.pdf')).toBeNull();
  });
});

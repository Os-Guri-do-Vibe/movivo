import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  complianceResponse,
  knowledgeDocumentsResponse,
  partnerDistributionResponse,
  financeResponse,
  marketingResponse,
  overviewResponse,
  studentDetailResponse,
  studentsResponse,
  systemResponse,
} from '../../test/control-center-fixtures';

import {
  ControlCenterApiError,
  getAuditEvents,
  getComplianceSummary,
  getFinanceSummary,
  getKnowledgeDocumentContent,
  getKnowledgeDocuments,
  getPartnerDistribution,
  reviewKnowledgeDocument,
  uploadKnowledgeDocument,
  getMarketing,
  getOverview,
  getStudent,
  getStudents,
  getSystemSummary,
  parseControlCenterCompliance,
  parseControlCenterFinance,
  parseControlCenterMarketing,
  parseControlCenterOverview,
  parseControlCenterStudent,
  parseControlCenterStudents,
  parseControlCenterSystem,
} from './control-center-api';

const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

const metric = {
  value: 1,
  unit: 'COUNT',
  status: 'AVAILABLE',
  definition: 'Definição testável.',
};
const meta = {
  generatedAt: '2026-08-11T15:00:00.000Z',
  timezone: 'America/Sao_Paulo',
  dataQuality: [],
};

describe('transporte do Control Center', () => {
  it.each([
    ['overview', getOverview, overviewResponse],
    ['marketing', getMarketing, marketingResponse],
    ['students', getStudents, studentsResponse],
    ['system', getSystemSummary, systemResponse],
    ['finance', getFinanceSummary, financeResponse],
    ['compliance', getComplianceSummary, complianceResponse],
  ])('%s consulta o próprio setor e devolve o dado validado', async (path, load, payload) => {
    fetchMock.mockResolvedValue(jsonResponse(payload));
    await expect(load()).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/dashboard/control/${path}`,
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('escapa o id do aluno na rota de detalhe e repassa o AbortSignal', async () => {
    fetchMock.mockResolvedValue(jsonResponse(studentDetailResponse));
    const controller = new AbortController();
    await expect(getStudent('a b/c', controller.signal)).resolves.toEqual(studentDetailResponse);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/dashboard/control/students/a%20b%2Fc',
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it('traduz 403 em erro de acesso sem vazar detalhe do servidor', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 403));
    const error = await getOverview().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ControlCenterApiError);
    expect(error).toMatchObject({ status: 403, message: 'Seu papel não pode acessar este setor.' });
  });

  it('prefere a mensagem enviada pelo servidor quando ela existe', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'Setor em manutenção.' }, 503));
    await expect(getSystemSummary()).rejects.toMatchObject({
      status: 503,
      message: 'Setor em manutenção.',
    });
  });

  it('usa mensagem genérica quando o corpo do erro não é JSON legível', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('corpo vazio');
      },
    });
    await expect(getMarketing()).rejects.toMatchObject({
      status: 500,
      message: 'Não foi possível carregar este setor.',
    });
  });

  it('resposta 200 fora do contrato vira 502 em vez de renderizar dado inválido', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { activeSubscriptions: 42 }, meta }));
    await expect(getOverview()).rejects.toMatchObject({
      status: 502,
      message: 'O setor devolveu dados fora do contrato esperado.',
    });
  });

  it('propaga o AbortError da rede sem convertê-lo em erro de contrato', async () => {
    const abort = new DOMException('Aborted', 'AbortError');
    fetchMock.mockRejectedValue(abort);
    await expect(getStudents()).rejects.toBe(abort);
  });
});

describe('projeções do Control Center', () => {
  it.each([
    ['visão geral', parseControlCenterOverview, overviewResponse],
    ['sistema', parseControlCenterSystem, systemResponse],
    ['alunos', parseControlCenterStudents, studentsResponse],
    ['detalhe do aluno', parseControlCenterStudent, studentDetailResponse],
    ['compliance', parseControlCenterCompliance, complianceResponse],
  ])('%s aceita a projeção completa do contrato', (_name, parse, payload) => {
    expect(parse(payload)).toEqual(payload);
  });

  it('financeiro descarta campos de saúde injetados fora do contrato', () => {
    const parsed = parseControlCenterFinance({
      data: {
        ...financeResponse.data,
        healthConditions: ['não pode aparecer'],
      },
      meta,
    });
    expect(parsed.data).not.toHaveProperty('healthConditions');
  });

  it('marketing recusa segmento menor que dez pessoas', () => {
    expect(() =>
      parseControlCenterMarketing({
        data: {
          funnel: {
            formStarted: metric,
            formSubmitted: metric,
            protocolActive: metric,
            subscriptionActive: metric,
          },
          acquisition: metric,
          segments: [{ dimension: 'PRIMARY_GOAL', value: 'Objetivo', count: 9 }],
          suppressedSegments: 2,
          minimumSegmentSize: 10,
        },
        meta,
      }),
    ).toThrow();
  });

  it('recusa métrica sem status de disponibilidade — nulo precisa ser declarado', () => {
    const [firstPillar, ...restPillars] = overviewResponse.data.pillars;
    expect(firstPillar).toBeDefined();
    expect(() =>
      parseControlCenterOverview({
        data: {
          pillars: [
            {
              ...firstPillar,
              headline: {
                ...firstPillar?.headline,
                metric: { value: null, unit: 'COUNT', definition: 'Sem status.' },
              },
            },
            ...restPillars,
          ],
        },
        meta,
      }),
    ).toThrow();
  });

  it('lista de alunos descarta conteúdo de saúde fora da projeção', () => {
    const parsed = parseControlCenterStudents({
      data: {
        students: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Pessoa',
            email: 'pessoa@teste.com',
            phoneNumber: '+5511999999999',
            status: 'ACTIVE',
            subscriptionStatus: 'ACTIVE',
            subscriptionPlan: 'MONTHLY',
            protocolStatus: null,
            enrolledAt: '2026-08-01T09:00:00.000Z',
            churnRisk: { score: 0, signals: [] },
            parqState: 'BLOQUEADO',
          },
        ],
        aiBlockedRate: { value: 0, unit: 'PERCENT', status: 'AVAILABLE', definition: 'Zero.' },
        northStar: {
          averageCompletions: { value: 0, unit: 'COUNT', status: 'AVAILABLE', definition: 'Zero.' },
          target: 8,
          reportingRate: { value: 0, unit: 'PERCENT', status: 'AVAILABLE', definition: 'Zero.' },
          cohortSize: 0,
          bySource: [],
        },
        declaredAdherenceRate: {
          value: 0,
          unit: 'PERCENT',
          status: 'AVAILABLE',
          definition: 'Zero.',
        },
      },
      meta,
    });
    expect(parsed.data.students[0]).not.toHaveProperty('parqState');
  });
});

/** `getKnowledgeDocuments`/`uploadKnowledgeDocument` normalizam stage/errorCode em processingStage/processingError. */
const knowledgeDocumentsViewResponse = {
  ...knowledgeDocumentsResponse,
  data: {
    ...knowledgeDocumentsResponse.data,
    documents: knowledgeDocumentsResponse.data.documents.map((document) => ({
      ...document,
      processingStage: document.stage,
      processingError: document.errorCode,
    })),
  },
};

describe('mutações do pilar IA', () => {
  const uploadInput = {
    title: 'Guia de descanso entre séries',
    topic: 'descanso',
    category: 'OTHER' as const,
    originalFilename: 'guia.md',
    mimeType: 'text/markdown' as const,
    content: 'a'.repeat(120),
  };

  it('envia o documento como JSON no POST e devolve o corpus validado', async () => {
    fetchMock.mockResolvedValue(jsonResponse(knowledgeDocumentsResponse));
    await expect(uploadKnowledgeDocument(uploadInput)).resolves.toEqual(
      knowledgeDocumentsViewResponse,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/dashboard/control/ai/knowledge/upload',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify(uploadInput),
      }),
    );
  });

  it('403 na publicação fala de publicar, não de acessar o setor', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 403));
    await expect(
      reviewKnowledgeDocument({
        documentId: '11111111-1111-4111-8111-111111111111',
        decision: 'APPROVED',
        note: 'Revisado pelo profissional CREF',
      }),
    ).rejects.toMatchObject({
      status: 403,
      message: 'Seu papel pode ver a configuração, mas não publicar.',
    });
  });

  it('erro sem corpo legível na publicação usa a mensagem genérica de publicação', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error('corpo vazio');
      },
    });
    await expect(uploadKnowledgeDocument(uploadInput)).rejects.toMatchObject({
      status: 500,
      message: 'Não foi possível concluir a publicação.',
    });
  });

  it('200 fora do contrato na publicação vira 502 em vez de dado inválido na tela', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { documents: 'muitos' } }));
    await expect(uploadKnowledgeDocument(uploadInput)).rejects.toMatchObject({
      status: 502,
      message: 'A publicação devolveu dados fora do contrato esperado.',
    });
  });
});

describe('rotas com parâmetro', () => {
  it('monta a busca de auditoria só com os filtros preenchidos', async () => {
    const auditResponse = {
      data: {
        events: [],
        actors: [],
        actions: [],
        pagination: { page: 2, pageSize: 20, total: 0, totalPages: 0 },
      },
      meta,
    };
    fetchMock.mockResolvedValue(jsonResponse(auditResponse));
    await expect(
      getAuditEvents({ action: 'HEALTH_DATA_READ', page: 2, pageSize: 20 }),
    ).resolves.toEqual(auditResponse);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('/api/dashboard/control/audit?action=HEALTH_DATA_READ&page=2&pageSize=20');
    expect(url).not.toContain('actorId');
  });

  it('escapa o id do documento na rota de conteúdo em quarentena', async () => {
    const contentResponse = {
      data: { id: '11111111-1111-4111-8111-111111111111', content: 'texto original' },
      meta,
    };
    fetchMock.mockResolvedValue(jsonResponse(contentResponse));
    await expect(getKnowledgeDocumentContent('a b/c')).resolves.toEqual(contentResponse);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/dashboard/control/ai/knowledge/a%20b%2Fc/content',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it.each([
    [
      'ai/knowledge',
      getKnowledgeDocuments,
      knowledgeDocumentsResponse,
      knowledgeDocumentsViewResponse,
    ],
    ['partners', getPartnerDistribution, partnerDistributionResponse, partnerDistributionResponse],
  ])(
    '%s consulta o próprio setor e devolve o dado validado',
    async (path, load, payload, expected) => {
      fetchMock.mockResolvedValue(jsonResponse(payload));
      await expect(load()).resolves.toEqual(expected);
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/dashboard/control/${path}`,
        expect.objectContaining({ credentials: 'same-origin' }),
      );
    },
  );
});

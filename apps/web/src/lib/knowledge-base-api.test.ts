import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  archiveKnowledgeDocument,
  getKnowledgeDocuments,
  retryKnowledgeDocument,
} from './control-center-api';

const fetchMock = vi.fn();
const ID = '11111111-1111-4111-8111-111111111111';
const meta = {
  generatedAt: '2026-08-20T12:00:00.000Z',
  timezone: 'America/Sao_Paulo',
  dataQuality: [],
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const knowledgeResponse = {
  data: {
    documents: [
      {
        id: ID,
        title: 'Evidência de descanso',
        topic: 'descanso',
        category: 'SCIENTIFIC_EVIDENCE',
        logicalKey: 'evidencia-descanso',
        version: 1,
        sourceUrl: null,
        author: null,
        license: null,
        originalFilename: 'descanso.md',
        mimeType: 'text/markdown',
        sizeBytes: 120,
        sha256: 'b'.repeat(64),
        status: 'FAILED',
        stage: 'EXTRACTION',
        errorCode: 'PARSER_TIMEOUT',
        canRetry: true,
        uploadedBy: 'Admin',
        reviewer: null,
        reviewNote: null,
        createdAt: '2026-08-20T12:00:00.000Z',
        reviewedAt: null,
        retainedUntil: '2026-09-20T12:00:00.000Z',
        blobAvailable: true,
        chunkCount: 0,
      },
    ],
    policy: {
      allowedTypes: ['text/plain', 'text/markdown'],
      maxBytes: 524288,
      quarantineDays: 30,
      approvedOriginalDays: 365,
    },
  },
  meta,
};

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe('contratos da Base de Conhecimento', () => {
  it('normaliza etapa e falha do processamento e chama retry/archive por UUID', async () => {
    fetchMock.mockResolvedValue(jsonResponse(knowledgeResponse));
    const response = await getKnowledgeDocuments();
    expect(response.data.documents[0]).toMatchObject({
      status: 'FAILED',
      processingStage: 'EXTRACTION',
      processingError: 'PARSER_TIMEOUT',
      canRetry: true,
    });

    await retryKnowledgeDocument(ID);
    await archiveKnowledgeDocument(ID, 'Fonte substituída por versão nova');
    expect(fetchMock.mock.calls.slice(1).map(([path]) => path)).toEqual([
      `/api/dashboard/control/ai/knowledge/${ID}/retry`,
      `/api/dashboard/control/ai/knowledge/${ID}/archive`,
    ]);
  });
});

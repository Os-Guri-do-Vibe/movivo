import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  archiveKnowledgeDocument,
  createMethodologyVersion,
  getKnowledgeDocuments,
  getMethodology,
  publishMethodologyVersion,
  retryKnowledgeDocument,
  reviewMethodologyVersion,
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

const methodologyResponse = {
  data: {
    versions: [
      {
        id: ID,
        version: 1,
        versionLabel: 'methodology-v1',
        content: 'metodologia segura',
        contentSha256: 'a'.repeat(64),
        changeNote: 'Migração inicial',
        status: 'PUBLISHED',
        createdBy: 'Admin',
        lastActor: 'Profissional CREF',
        createdAt: '2026-08-19T12:00:00.000Z',
        statusChangedAt: '2026-08-20T12:00:00.000Z',
      },
    ],
    currentVersionId: ID,
  },
  meta,
};

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
  it('normaliza o contrato versionado da metodologia e identifica a vigente', async () => {
    fetchMock.mockResolvedValue(jsonResponse(methodologyResponse));
    const response = await getMethodology();
    expect(response.data.versions[0]).toMatchObject({
      version: 1,
      sha256: 'a'.repeat(64),
      reviewedBy: 'Profissional CREF',
      publishedAt: '2026-08-20T12:00:00.000Z',
      current: true,
    });
  });

  it('usa os paths REST explícitos para criar, revisar e publicar', async () => {
    fetchMock.mockResolvedValue(jsonResponse(methodologyResponse));
    await createMethodologyVersion({ content: 'x'.repeat(200), changeNote: 'Mudança auditável' });
    await reviewMethodologyVersion(ID, { decision: 'APPROVED', note: 'Parecer favorável' });
    await publishMethodologyVersion(ID, 'Publicação autorizada');

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/dashboard/control/ai/methodology',
      `/api/dashboard/control/ai/methodology/${ID}/review`,
      `/api/dashboard/control/ai/methodology/${ID}/publish`,
    ]);
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({ decision: 'APPROVED', note: 'Parecer favorável' }),
      }),
    );
  });

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

import { describe, expect, it, vi } from 'vitest';
import type { PinoLogger } from 'nestjs-pino';

import type { RagDoc } from '../context/semantic-memory.port';
import type { LlmRouter } from '../llm/llm-router.service';
import { EvidenceGroundingService } from './evidence-grounding.service';

const documents: RagDoc[] = [
  {
    chunkId: 'chunk-1',
    documentId: 'doc-1',
    title: 'Metodologia de descanso',
    snippet: 'Para hipertrofia, o intervalo recomendado entre séries é de 60 a 90 segundos.',
    score: 0.92,
    category: 'METHODOLOGY',
    reliability: 5,
    documentVersion: 2,
    retrievalMode: 'SINGLE_HOP',
  },
];

function request() {
  return {
    userId: 'u1',
    operationId: 'op-1',
    user: {},
    question: 'Quanto descanso entre séries para hipertrofia?',
    authoritativeState: '{"temProtocoloAtivo":true,"restricoes":[]}',
    system: 'Responda dentro do escopo do profissional CREF.',
    contextMessages: [{ role: 'user' as const, content: 'estado estruturado' }],
    documents,
    maxClaims: 2,
    personaSlot: null,
  };
}

function make(outputs: string[]) {
  const complete = vi.fn();
  outputs.forEach((text) => complete.mockResolvedValueOnce({ text, model: 'deepseek-v4-pro' }));
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
  return {
    service: new EvidenceGroundingService({ complete } as unknown as LlmRouter, logger),
    complete,
  };
}

describe('EvidenceGroundingService', () => {
  it('entrega somente afirmações verificadas e mostra a fonte inline', async () => {
    const { service, complete } = make([
      JSON.stringify({
        sufficient: true,
        relevantEvidenceIds: ['E1'],
        missingAspects: [],
        conflicts: [],
      }),
      JSON.stringify({
        claims: [
          { id: 'C1', text: 'Descanse de 60 a 90 segundos entre as séries.', evidenceIds: ['E1'] },
        ],
        humanReview: false,
      }),
      JSON.stringify({
        verdicts: [{ claimId: 'C1', verdict: 'SUPPORTED', evidenceIds: ['E1'] }],
      }),
    ]);

    const result = await service.answer(request());

    expect(result).toMatchObject({ status: 'VERIFIED', model: 'deepseek-v4-pro' });
    if (result.status !== 'VERIFIED') return;
    expect(result.text).toContain('[E1: Metodologia de descanso v2]');
    expect(result.sources[0]).toMatchObject({ evidenceId: 'E1', claimIds: ['C1'] });
    expect(complete).toHaveBeenCalledTimes(3);
    expect(complete.mock.calls.map((call) => call[0].operationId)).toEqual([
      'op-1',
      'op-1',
      'op-1',
    ]);
  });

  it('se abstém quando o assessor declara evidência insuficiente', async () => {
    const { service, complete } = make([
      JSON.stringify({
        sufficient: false,
        relevantEvidenceIds: [],
        missingAspects: ['A fonte não responde à progressão.'],
        conflicts: [],
      }),
    ]);

    await expect(service.answer(request())).resolves.toMatchObject({ status: 'INSUFFICIENT' });
    expect(complete).toHaveBeenCalledOnce();
  });

  it('bloqueia número inventado deterministicamente antes de pagar o verificador', async () => {
    const { service, complete } = make([
      JSON.stringify({
        sufficient: true,
        relevantEvidenceIds: ['E1'],
        missingAspects: [],
        conflicts: [],
      }),
      JSON.stringify({
        claims: [{ id: 'C1', text: 'Descanse exatamente 10 segundos.', evidenceIds: ['E1'] }],
        humanReview: false,
      }),
      JSON.stringify({
        verdicts: [{ claimId: 'C1', verdict: 'CONTRADICTED', evidenceIds: ['E1'] }],
      }),
    ]);

    await expect(service.answer(request())).resolves.toMatchObject({ status: 'UNVERIFIED' });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('bloqueia toda a resposta quando uma afirmação não passa no verificador semântico', async () => {
    const { service, complete } = make([
      JSON.stringify({
        sufficient: true,
        relevantEvidenceIds: ['E1'],
        missingAspects: [],
        conflicts: [],
      }),
      JSON.stringify({
        claims: [
          {
            id: 'C1',
            text: 'Mantenha 60 a 90 segundos mesmo se houver dor.',
            evidenceIds: ['E1'],
          },
        ],
        humanReview: false,
      }),
      JSON.stringify({
        verdicts: [{ claimId: 'C1', verdict: 'INSUFFICIENT', evidenceIds: ['E1'] }],
      }),
    ]);

    await expect(service.answer(request())).resolves.toMatchObject({ status: 'UNVERIFIED' });
    expect(complete).toHaveBeenCalledTimes(3);
  });

  it('falha fechado quando qualquer etapa devolve JSON inválido', async () => {
    const { service } = make(['não é JSON']);
    await expect(service.answer(request())).resolves.toMatchObject({ status: 'UNVERIFIED' });
  });
});

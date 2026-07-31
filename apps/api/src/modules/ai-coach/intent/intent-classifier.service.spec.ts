import { describe, expect, it, vi } from 'vitest';

import type { EmbeddingPort } from '../rag/embedding.port';
import type { LlmRouter } from '../llm/llm-router.service';
import type { IntentRepository } from './intent.repository';
import { IntentClassifier, parseIntent } from './intent-classifier.service';

function make(overrides?: { knn?: { intent: string; confidence: number } | null; nano?: string }) {
  const embedding = { embed: vi.fn().mockResolvedValue([0.1, 0.2]) } as unknown as EmbeddingPort;
  const repo = {
    classifyByKnn: vi.fn().mockResolvedValue(overrides?.knn ?? null),
  } as unknown as IntentRepository;
  const complete = vi.fn().mockResolvedValue({ text: overrides?.nano ?? 'MOTIVACAO' });
  const llm = { complete } as unknown as LlmRouter;
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() } as never;
  const svc = new IntentClassifier(embedding, repo, llm, logger);
  return { svc, embedding, repo, complete };
}

const input = { userId: 'u1', user: { name: null, phoneNumber: null, email: null }, message: '' };

describe('IntentClassifier — guardrail (Etapa 0)', () => {
  it('dor grave → FORA_DE_ESCOPO + handoff de segurança, ANTES de custo de IA', async () => {
    const { svc, embedding, complete } = make();
    const r = await svc.classify({ ...input, message: 'estou com dor no peito' });
    expect(r).toMatchObject({ intent: 'FORA_DE_ESCOPO', stage: 'GUARDRAIL', safetyHandoff: true });
    expect(embedding.embed).not.toHaveBeenCalled(); // não pagou embedding
    expect(complete).not.toHaveBeenCalled(); // nem LLM
  });

  it('fora de escopo (remédio) → FORA_DE_ESCOPO sem handoff, sem custo de IA', async () => {
    const { svc, embedding } = make();
    const r = await svc.classify({ ...input, message: 'posso tomar dipirona?' });
    expect(r).toMatchObject({ intent: 'FORA_DE_ESCOPO', stage: 'GUARDRAIL', safetyHandoff: false });
    expect(embedding.embed).not.toHaveBeenCalled();
  });
});

describe('IntentClassifier — kNN (Etapa 1) e fallback (Etapa 2)', () => {
  it('kNN com confiança alta resolve sem chamar o LLM', async () => {
    const { svc, complete } = make({ knn: { intent: 'DUVIDA_TECNICA', confidence: 0.9 } });
    const r = await svc.classify({ ...input, message: 'como faço agachamento?' });
    expect(r).toMatchObject({ intent: 'DUVIDA_TECNICA', stage: 'KNN' });
    expect(complete).not.toHaveBeenCalled();
  });

  it('kNN com confiança baixa cai no fallback nano', async () => {
    const { svc, complete } = make({
      knn: { intent: 'MOTIVACAO', confidence: 0.2 },
      nano: 'SAUDACAO',
    });
    const r = await svc.classify({ ...input, message: 'e aí' });
    expect(r).toMatchObject({ intent: 'SAUDACAO', stage: 'FALLBACK' });
    expect(complete).toHaveBeenCalledOnce();
  });

  it('sem exemplos (kNN null) cai no fallback', async () => {
    const { svc, complete } = make({ knn: null, nano: 'DUVIDA_TECNICA' });
    const r = await svc.classify({ ...input, message: 'qualquer coisa' });
    expect(r.stage).toBe('FALLBACK');
    expect(complete).toHaveBeenCalledOnce();
  });
});

describe('parseIntent', () => {
  it('extrai o rótulo conhecido da saída do nano', () => {
    expect(parseIntent('a intenção é SUBSTITUICAO_EXERCICIO')).toBe('SUBSTITUICAO_EXERCICIO');
  });
  it('saída desconhecida → FORA_DE_ESCOPO (fail-safe)', () => {
    expect(parseIntent('sei lá')).toBe('FORA_DE_ESCOPO');
  });
});

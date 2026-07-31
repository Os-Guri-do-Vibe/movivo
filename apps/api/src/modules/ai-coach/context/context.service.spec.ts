import { describe, expect, it, vi } from 'vitest';

import type { ContextRepository, EpisodicMemory } from './context.repository';
import { ContextService } from './context.service';
import type { SemanticMemoryPort } from './semantic-memory.port';
import type { WorkingMemory } from './working-memory.service';

const scrubUser = { name: 'João Silva', phoneNumber: '+5511999998888', email: 'joao@ex.com' };

function make(overrides?: {
  episodic?: Partial<EpisodicMemory>;
  recent?: { role: 'user' | 'assistant'; content: string; ts: number }[];
  count?: number;
  ragDocs?: { title: string; snippet: string; score: number }[];
}) {
  const episodic: EpisodicMemory = {
    scrubUser,
    state: { temProtocoloAtivo: true, semanaAtual: 3, fase: 'HIPERTROFIA' },
    summary: null,
    ...overrides?.episodic,
  };
  const loadEpisodic = vi.fn().mockResolvedValue(episodic);
  const loadScrubUser = vi.fn().mockResolvedValue(scrubUser);
  const upsertSummary = vi.fn().mockResolvedValue(undefined);
  const repo = { loadEpisodic, loadScrubUser, upsertSummary } as unknown as ContextRepository;

  const recent = vi
    .fn()
    .mockResolvedValue(overrides?.recent ?? [{ role: 'user', content: 'oi', ts: 1 }]);
  const count = vi.fn().mockResolvedValue(overrides?.count ?? 2);
  const append = vi.fn().mockResolvedValue(undefined);
  const working = { recent, count, append } as unknown as WorkingMemory;

  const retrieve = vi.fn().mockResolvedValue(overrides?.ragDocs ?? []);
  const semantic = { retrieve } as unknown as SemanticMemoryPort;

  const complete = vi.fn().mockResolvedValue({ text: 'resumo curto' });
  const llm = { complete };
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() };
  const svc = new ContextService(repo, working, semantic, llm as never, logger as never);
  return { svc, loadEpisodic, upsertSummary, append, retrieve, complete };
}

describe('ContextService.build', () => {
  it('monta prefixo (estado) + sufixo (janela + mensagem atual)', async () => {
    const { svc } = make({ recent: [{ role: 'assistant', content: 'Bora treinar!', ts: 1 }] });
    const ctx = await svc.build('u1', 'MOTIVACAO', 'to sem vontade');
    expect(ctx.cacheablePrefix).toContain('ESTADO ATUAL DO ALUNO');
    expect(ctx.cacheablePrefix).toContain('HIPERTROFIA');
    expect(ctx.volatileSuffix).toContain('MOVI: Bora treinar!');
    expect(ctx.volatileSuffix).toContain('Aluno: to sem vontade');
  });

  it('só chama o RAG em DUVIDA_TECNICA', async () => {
    const rag = make({ ragDocs: [{ title: 't', snippet: 'descanse 90s', score: 0.9 }] });
    const ctx = await rag.svc.build('u1', 'DUVIDA_TECNICA', 'quanto descanso?');
    expect(rag.retrieve).toHaveBeenCalledOnce();
    expect(ctx.ragDocs).toHaveLength(1);

    const nonRag = make({ ragDocs: [{ title: 't', snippet: 'x', score: 0.9 }] });
    await nonRag.svc.build('u1', 'MOTIVACAO', 'oi');
    expect(nonRag.retrieve).not.toHaveBeenCalled();
  });

  it('passa o PII Scrubber sobre tudo (nome do usuário sai do contexto)', async () => {
    const { svc } = make();
    const ctx = await svc.build('u1', 'MOTIVACAO', 'meu nome é João Silva');
    expect(ctx.volatileSuffix).not.toContain('João');
    expect(ctx.volatileSuffix).toContain('o usuário');
  });

  it('inclui o resumo no prefixo quando existe', async () => {
    const { svc } = make({ episodic: { summary: 'Aluno relatou dor no ombro semana passada.' } });
    const ctx = await svc.build('u1', 'MOTIVACAO', 'oi');
    expect(ctx.cacheablePrefix).toContain('RESUMO DA CONVERSA');
  });
});

describe('ContextService.summarizeIfNeeded', () => {
  it('não resume abaixo do limiar', async () => {
    const { svc, complete, upsertSummary } = make({ count: 10 });
    await svc.summarizeIfNeeded('u1');
    expect(complete).not.toHaveBeenCalled();
    expect(upsertSummary).not.toHaveBeenCalled();
  });

  it('resume e persiste acima do limiar', async () => {
    const { svc, complete, upsertSummary } = make({
      count: 20,
      recent: [{ role: 'user', content: 'blá', ts: 1 }],
    });
    await svc.summarizeIfNeeded('u1');
    expect(complete).toHaveBeenCalledOnce();
    expect(upsertSummary).toHaveBeenCalledWith('u1', expect.any(String), 'resumo curto');
  });
});

describe('ContextService.recordTurn', () => {
  it('grava o turno na working memory', async () => {
    const { svc, append } = make();
    await svc.recordTurn('u1', 'assistant', 'resposta da MOVI');
    expect(append).toHaveBeenCalledWith(
      'u1',
      expect.any(String),
      expect.objectContaining({ role: 'assistant', content: 'resposta da MOVI' }),
    );
  });
});

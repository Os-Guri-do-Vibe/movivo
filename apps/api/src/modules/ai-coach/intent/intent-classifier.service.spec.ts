import { describe, expect, it, vi } from 'vitest';

import type { EmbeddingPort } from '../rag/embedding.port';
import type { WorkingMemory } from '../context/working-memory.service';
import type { LlmRouter } from '../llm/llm-router.service';
import type { IntentRepository } from './intent.repository';
import { IntentClassifier, parseIntent } from './intent-classifier.service';

function make(overrides?: {
  knn?: { intent: string; confidence: number } | null;
  nano?: string;
  recentTurns?: Array<{ role: 'user' | 'assistant'; content: string; ts: number }>;
}) {
  const embedding = { embed: vi.fn().mockResolvedValue([0.1, 0.2]) } as unknown as EmbeddingPort;
  const repo = {
    classifyByKnn: vi.fn().mockResolvedValue(overrides?.knn ?? null),
  } as unknown as IntentRepository;
  const complete = vi.fn().mockResolvedValue({ text: overrides?.nano ?? 'MOTIVACAO' });
  const llm = { complete } as unknown as LlmRouter;
  const working = {
    recent: vi.fn().mockResolvedValue(overrides?.recentTurns ?? []),
  } as unknown as WorkingMemory;
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() } as never;
  const svc = new IntentClassifier(embedding, repo, llm, working, logger);
  return { svc, embedding, repo, complete, working };
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
  it('remove PII antes de enviar a mensagem ao embedding', async () => {
    const { svc, embedding } = make({ knn: { intent: 'DUVIDA_TECNICA', confidence: 0.9 } });
    await svc.classify({
      ...input,
      user: { name: 'João Silva', phoneNumber: '+5511999998888', email: 'joao@ex.com' },
      message: 'João Silva joao@ex.com +5511999998888 quer saber sobre agachamento',
    });
    const embedded = String(vi.mocked(embedding.embed).mock.calls[0]?.[0]);
    expect(embedded).not.toContain('João Silva');
    expect(embedded).not.toContain('joao@ex.com');
    expect(embedded).not.toContain('+5511999998888');
  });

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

  // Achado 2026-09-10 (bug reportado pelo fundador, reproduzido ao vivo): "vou descansar
  // mais entre as séries então" (aceitando um ajuste de treino sugerido pela IA na resposta
  // anterior) foi classificado errado — a mensagem sozinha, sem o contexto de que era uma
  // continuação sobre descanso ENTRE SÉRIES no treino, não tinha como ser desambiguada.
  // Garante que o histórico recente chega no fallback.
  it('passa o histórico recente da conversa pro fallback nano, pra desambiguar uma continuação', async () => {
    const { svc, complete } = make({
      knn: null,
      nano: 'CHECKIN_ANTECIPADO',
      recentTurns: [
        { role: 'user', content: 'que treino de perna difícil, quase morri', ts: 1 },
        {
          role: 'assistant',
          content: 'Quer que eu veja com você em qual exercício do Dia 3 vale mexer primeiro?',
          ts: 2,
        },
        { role: 'user', content: 'vou descansar mais entre as series entao', ts: 3 },
      ],
    });

    const r = await svc.classify({
      ...input,
      message: 'vou descansar mais entre as series entao',
    });

    expect(r).toMatchObject({ intent: 'CHECKIN_ANTECIPADO', stage: 'FALLBACK' });
    const call = complete.mock.calls[0]?.[0];
    expect(call.system).toContain('CHECKIN_ANTECIPADO: quer ajustar o PROTOCOLO agora');
    expect(JSON.stringify(call.messages)).toContain('CONTEXTO RECENTE DA CONVERSA');
    expect(JSON.stringify(call.messages)).toContain('quase morri');
    // A mensagem atual não duplica no bloco de histórico (já foi persistida antes de
    // classificar) — só aparece uma vez, na mensagem "atual" embrulhada.
    expect(
      JSON.stringify(call.messages).split('vou descansar mais entre as series entao').length - 1,
    ).toBe(1);
  });

  // Achado 2026-09-02 (reproduzido ao vivo — aluno viu "digitando…" e depois silêncio
  // permanente): o embedding lançando sem try/catch derrubava a classificação inteira, e
  // por consequência o job de resposta inteiro, DEPOIS de já ter drenado a mensagem do
  // aluno do lote — a retry do BullMQ achava o lote vazio e "terminava com sucesso" sem
  // nunca responder. Etapa 1 agora é best-effort, mesmo padrão de `retrieveEvidence` do RAG.
  it('embedding indisponível (ex.: 429 do provedor) não derruba a classificação — cai no fallback nano', async () => {
    const { svc, embedding, repo, complete } = make({ nano: 'DUVIDA_TECNICA' });
    vi.mocked(embedding.embed).mockRejectedValue(
      new Error('Provider de embedding recusou a requisição (429).'),
    );
    const r = await svc.classify({ ...input, message: 'como faço agachamento?' });
    expect(r).toMatchObject({ intent: 'DUVIDA_TECNICA', stage: 'FALLBACK' });
    expect(repo.classifyByKnn).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledOnce();
  });

  it('erro no repositório de kNN (ex.: banco fora do ar) também cai no fallback nano', async () => {
    const { svc, repo, complete } = make({ nano: 'MOTIVACAO' });
    vi.mocked(repo.classifyByKnn).mockRejectedValue(new Error('connection refused'));
    const r = await svc.classify({ ...input, message: 'e aí' });
    expect(r).toMatchObject({ intent: 'MOTIVACAO', stage: 'FALLBACK' });
    expect(complete).toHaveBeenCalledOnce();
  });
});

// Achado BLOQUEANTE do Victor: antes disso, handoff de segurança só existia via regex.
describe('IntentClassifier — EMERGENCIA_CLINICA fora do guardrail regex', () => {
  it('kNN classifica red flag que a regex não pega → safetyHandoff', async () => {
    const { svc } = make({ knn: { intent: 'EMERGENCIA_CLINICA', confidence: 0.85 } });
    const r = await svc.classify({ ...input, message: 'meu braço esquerdo tá formigando' });
    expect(r).toMatchObject({
      intent: 'EMERGENCIA_CLINICA',
      stage: 'KNN',
      safetyHandoff: true,
    });
  });

  it('fallback nano classifica red flag ambíguo → safetyHandoff', async () => {
    const { svc } = make({ knn: null, nano: 'EMERGENCIA_CLINICA' });
    const r = await svc.classify({ ...input, message: 'senti a vista escurecer no agachamento' });
    expect(r).toMatchObject({
      intent: 'EMERGENCIA_CLINICA',
      stage: 'FALLBACK',
      safetyHandoff: true,
    });
  });

  it('intenção normal não dispara handoff de segurança', async () => {
    const { svc } = make({ knn: { intent: 'MOTIVACAO', confidence: 0.9 } });
    const r = await svc.classify({ ...input, message: 'tô sem vontade hoje' });
    expect(r.safetyHandoff).toBe(false);
  });

  it('o rótulo é oferecido ao nano na lista de intenções', async () => {
    const { svc, complete } = make({ knn: null, nano: 'MOTIVACAO' });
    await svc.classify({ ...input, message: 'qualquer coisa' });
    expect(complete.mock.calls[0]?.[0]?.system).toContain('EMERGENCIA_CLINICA');
    expect(complete.mock.calls[0]?.[0]?.system).toContain('PAPO_CASUAL');
  });
});

describe('IntentClassifier — default-deny (nenhum caminho vira prompt sem guardrail)', () => {
  it('rótulo desconhecido do kNN não é aceito — cai no fallback', async () => {
    const { svc, complete } = make({
      knn: { intent: 'CONVERSA_LIVRE', confidence: 0.99 },
      nano: 'MOTIVACAO',
    });
    const r = await svc.classify({ ...input, message: 'assunto qualquer' });
    expect(r.intent).not.toBe('CONVERSA_LIVRE');
    expect(complete).toHaveBeenCalledOnce();
  });

  it('fallback com saída vazia/ambígua → FORA_DE_ESCOPO', async () => {
    const { svc } = make({ knn: null, nano: '' });
    const r = await svc.classify({ ...input, message: 'hmmm' });
    expect(r.intent).toBe('FORA_DE_ESCOPO');
  });
});

describe('parseIntent', () => {
  it('reconhece papo casual classificado pelo modelo', () => {
    expect(parseIntent('PAPO_CASUAL')).toBe('PAPO_CASUAL');
  });
  it('extrai o rótulo conhecido da saída do nano', () => {
    expect(parseIntent('a intenção é SUBSTITUICAO_EXERCICIO')).toBe('SUBSTITUICAO_EXERCICIO');
  });
  it('saída desconhecida → FORA_DE_ESCOPO (fail-safe)', () => {
    expect(parseIntent('sei lá')).toBe('FORA_DE_ESCOPO');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_AGENT_PERSONA } from '@movivo/shared';

import type { AgentPersonaService } from '../../core/agent-config/agent-persona.service';
import type { LlmRouter } from '../ai-coach/llm/llm-router.service';
import type { LLMRequest, LLMResult } from '../ai-coach/llm/llm.types';
import { ValidationService } from '../protocol/validation/validation.service';
import { WorkoutFeedbackService, type WorkoutFeedbackParams } from './workout-feedback.service';

function llmResult(text: string): LLMResult {
  return {
    text,
    provider: 'OPENAI_GPT41',
    model: 'gpt-4.1',
    tokensInput: 100,
    tokensOutput: 40,
    tokensCached: 0,
    latencyMs: 20,
    attempt: 1,
    dataClass: 'HEALTH',
    costBrl: 0.001,
  };
}

function makeService(opts: {
  complete: (req: LLMRequest) => Promise<LLMResult>;
  validationVerdict?: 'PASS' | 'BLOCK_FALLBACK';
}) {
  const complete = vi.fn(opts.complete);
  const llm = { complete } as unknown as LlmRouter;
  const validation = new ValidationService();
  if (opts.validationVerdict === 'BLOCK_FALLBACK') {
    vi.spyOn(validation, 'validateResponse').mockReturnValue({
      action: 'BLOCK_FALLBACK',
      code: 'BLOCK',
      humanReviewRequired: true,
      violations: [{ rule: 'DIAGNOSIS', detail: 'termo proibido', action: 'BLOCK' }],
    });
  }
  const persona = vi.fn(async () => DEFAULT_AGENT_PERSONA);
  const agentPersona = { persona } as unknown as AgentPersonaService;
  const logger = { warn: vi.fn(), setContext: vi.fn() } as never;
  const service = new WorkoutFeedbackService(llm, validation, agentPersona, logger);
  return { service, complete, persona };
}

const baseParams: WorkoutFeedbackParams = {
  userId: 'u1',
  user: { name: 'Ana', phoneNumber: '+5541999999999', email: null },
  biologicalSex: 'FEMALE',
  planejado: {
    foco: 'Corpo inteiro',
    exercicios: [{ name: 'Agachamento goblet', sets: 3 }],
  },
  realizado: [
    {
      exercicio: 'goblet_squat',
      series: [
        {
          serie: 1,
          reps: 10,
          carga: 12,
          unidade: 'KG',
          duracaoSegundos: null,
          concluida: true,
          pulada: false,
        },
      ],
    },
  ],
  esforcoPercebido: 7,
  dorRelatada: false,
  historicoRecente: [],
};

describe('WorkoutFeedbackService (achado 2026-09-12)', () => {
  it('gera e devolve o comentário quando a IA responde e passa na validação', async () => {
    const { service, complete, persona } = makeService({
      complete: async () => llmResult('Sua carga no agachamento subiu bem, continue assim.'),
    });
    const text = await service.comment(baseParams);
    expect(text).toBe('Sua carga no agachamento subiu bem, continue assim.');
    expect(persona).toHaveBeenCalledWith('FEMALE');
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: 'AI_RESPONSE', userId: 'u1', intent: 'workout_feedback' }),
    );
  });

  it('remove travessão da saída do LLM antes de devolver', async () => {
    const { service } = makeService({
      complete: async () => llmResult('Sua carga subiu — continue assim, sem enrolação.'),
    });
    const text = await service.comment(baseParams);
    expect(text).not.toContain('—');
    expect(text).toBe('Sua carga subiu, continue assim, sem enrolação.');
  });

  it('nunca lança — falha da LLM devolve undefined (bolha omitida)', async () => {
    const { service } = makeService({
      complete: async () => {
        throw new Error('todos os provedores falharam');
      },
    });
    await expect(service.comment(baseParams)).resolves.toBeUndefined();
  });

  it('reprovado pelo ValidationService (guardrail de linguagem) devolve undefined', async () => {
    const { service } = makeService({
      complete: async () => llmResult('Isso é um diagnóstico do seu quadro.'),
      validationVerdict: 'BLOCK_FALLBACK',
    });
    await expect(service.comment(baseParams)).resolves.toBeUndefined();
  });

  it('envia planejado x realizado, esforço e dor no prompt do usuário', async () => {
    const { service, complete } = makeService({
      complete: async () => llmResult('Comentário qualquer.'),
    });
    await service.comment(baseParams);
    const userMessage = complete.mock.calls[0]?.[0]?.messages[0]?.content ?? '';
    expect(userMessage).toContain('Corpo inteiro');
    expect(userMessage).toContain('Agachamento goblet (3 séries)');
    expect(userMessage).toContain('goblet_squat');
    expect(userMessage).toContain('série 1: 12kg, 10 reps');
    expect(userMessage).toContain('Esforço percebido informado pelo aluno (0-10): 7');
    expect(userMessage).toContain('Dor/desconforto relatado nesta sessão: não');
  });

  it('dor relatada: instrui a IA a reconhecer sem interpretar, e o prompt de usuário reflete "sim"', async () => {
    const { service, complete } = makeService({
      complete: async () => llmResult('Vi que você registrou dor, o profissional já vai olhar.'),
    });
    await service.comment({ ...baseParams, dorRelatada: true });
    const system = complete.mock.calls[0]?.[0]?.system ?? '';
    const userMessage = complete.mock.calls[0]?.[0]?.messages[0]?.content ?? '';
    expect(system).toContain('já acionou um alerta interno');
    expect(system).toContain('NUNCA comente causa, gravidade');
    expect(userMessage).toContain('Dor/desconforto relatado nesta sessão: sim');
  });

  it('inclui o histórico recente quando fornecido', async () => {
    const { service, complete } = makeService({
      complete: async () => llmResult('Comentário qualquer.'),
    });
    await service.comment({
      ...baseParams,
      historicoRecente: [{ data: '2026-09-05', resumo: 'Treino A, esforço percebido 6, dor: não' }],
    });
    const userMessage = complete.mock.calls[0]?.[0]?.messages[0]?.content ?? '';
    expect(userMessage).toContain('Histórico recente');
    expect(userMessage).toContain('2026-09-05: Treino A, esforço percebido 6, dor: não');
  });

  it('série pulada, sem carga e por duração (sem reps): reflete cada caso no prompt', async () => {
    const { service, complete } = makeService({
      complete: async () => llmResult('Comentário qualquer.'),
    });
    await service.comment({
      ...baseParams,
      realizado: [
        {
          exercicio: 'prancha',
          series: [
            {
              serie: 1,
              reps: null,
              carga: null,
              unidade: null,
              duracaoSegundos: 40,
              concluida: false,
              pulada: false,
            },
            {
              serie: 2,
              reps: null,
              carga: null,
              unidade: null,
              duracaoSegundos: null,
              concluida: true,
              pulada: true,
            },
          ],
        },
      ],
      esforcoPercebido: null,
      comentarioDoAluno: 'Doeu um pouco o ombro na segunda série.',
    });
    const userMessage = complete.mock.calls[0]?.[0]?.messages[0]?.content ?? '';
    expect(userMessage).toContain('série 1: s/carga, 40s (não concluída)');
    expect(userMessage).toContain('série 2 pulada');
    expect(userMessage).toContain('Esforço percebido informado pelo aluno (0-10): não informado');
    expect(userMessage).toContain(
      'Comentário livre do aluno sobre o treino: "Doeu um pouco o ombro na segunda série."',
    );
  });

  it('exercício realizado sem nenhuma série registrada', async () => {
    const { service, complete } = makeService({
      complete: async () => llmResult('Comentário qualquer.'),
    });
    await service.comment({
      ...baseParams,
      realizado: [{ exercicio: 'burpee', series: [] }],
    });
    const userMessage = complete.mock.calls[0]?.[0]?.messages[0]?.content ?? '';
    expect(userMessage).toContain('burpee — sem séries registradas.');
  });

  it('LLM devolve texto vazio após strip: comentário fica undefined', async () => {
    const { service } = makeService({
      complete: async () => llmResult('   '),
    });
    await expect(service.comment(baseParams)).resolves.toBeUndefined();
  });
});

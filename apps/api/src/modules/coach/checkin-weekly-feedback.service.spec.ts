import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_AGENT_PERSONA } from '@movivo/shared';

import type { AgentPersonaService } from '../../core/agent-config/agent-persona.service';
import type { LlmRouter } from '../ai-coach/llm/llm-router.service';
import type { LLMRequest, LLMResult } from '../ai-coach/llm/llm.types';
import { ValidationService } from '../protocol/validation/validation.service';
import {
  CheckinWeeklyFeedbackService,
  type CheckinWeeklyFeedbackParams,
} from './checkin-weekly-feedback.service';

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
  const service = new CheckinWeeklyFeedbackService(llm, validation, agentPersona, logger);
  return { service, complete, persona };
}

const baseParams: CheckinWeeklyFeedbackParams = {
  userId: 'u1',
  user: { name: 'Ana', phoneNumber: '+5541999999999', email: null },
  biologicalSex: 'FEMALE',
  sleepQuality: 'BOA',
  mood: 'FELIZ',
  nutritionScore: 8,
  adherenceScore: 9,
  changesNoticed: ['FORCA'],
  durationFit: 'ADEQUADA',
  dorRelatada: false,
};

describe('CheckinWeeklyFeedbackService', () => {
  it('gera e devolve o comentário quando a IA responde e passa na validação', async () => {
    const { service, complete, persona } = makeService({
      complete: async () => llmResult('Sua semana foi ótima, sono e alimentação em dia.'),
    });
    const text = await service.comment(baseParams);
    expect(text).toBe('Sua semana foi ótima, sono e alimentação em dia.');
    expect(persona).toHaveBeenCalledWith('FEMALE');
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'AI_RESPONSE',
        userId: 'u1',
        intent: 'checkin_weekly_feedback',
      }),
    );
  });

  it('remove travessão da saída do LLM antes de devolver', async () => {
    const { service } = makeService({
      complete: async () => llmResult('Sua semana foi boa — continue assim.'),
    });
    const text = await service.comment(baseParams);
    expect(text).not.toContain('—');
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

  it('envia sono, humor, alimentação e aderência no prompt do usuário', async () => {
    const { service, complete } = makeService({
      complete: async () => llmResult('Comentário qualquer.'),
    });
    await service.comment(baseParams);
    const userMessage = complete.mock.calls[0]?.[0]?.messages[0]?.content ?? '';
    expect(userMessage).toContain('Qualidade do sono na última semana: BOA');
    expect(userMessage).toContain('Humor na última semana: FELIZ');
    expect(userMessage).toContain('Alimentação nesta última semana (0-10): 8');
    expect(userMessage).toContain('0-10): 9');
  });

  it('menciona o ajuste de volume já aplicado como fato, sem perguntar', async () => {
    const { service, complete } = makeService({
      complete: async () => llmResult('Já ajustei seu treino.'),
    });
    await service.comment({
      ...baseParams,
      durationFit: 'MAIS_CURTOS',
      volumeAdjustmentSummary: 'reduziu 1 série do Supino Reto',
    });
    const system = complete.mock.calls[0]?.[0]?.system ?? '';
    expect(system).toContain('JÁ FOI AJUSTADO');
    expect(system).toContain('reduziu 1 série do Supino Reto');
    expect(system).toContain('nunca pergunte se o aluno quer');
  });

  it('oferece sugestão de substituição quando um exercício foi identificado', async () => {
    const { service, complete } = makeService({
      complete: async () => llmResult('Quer que eu sugira alternativas?'),
    });
    await service.comment({
      ...baseParams,
      difficultExerciseDescription: 'tive dificuldade no agachamento búlgaro',
      identifiedExerciseName: 'Agachamento Búlgaro',
    });
    const system = complete.mock.calls[0]?.[0]?.system ?? '';
    expect(system).toContain('Agachamento Búlgaro');
    expect(system).toContain('pergunta aberta');
  });

  it('dor relatada: instrui a IA a reconhecer sem interpretar', async () => {
    const { service, complete } = makeService({
      complete: async () => llmResult('Vi seu relato, o profissional vai olhar.'),
    });
    await service.comment({ ...baseParams, dorRelatada: true });
    const system = complete.mock.calls[0]?.[0]?.system ?? '';
    expect(system).toContain('já acionou um alerta interno');
    expect(system).toContain('NUNCA comente causa, gravidade');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_AGENT_PERSONA, type ProtocolStructure } from '@movivo/shared';

import type { AgentPersonaService } from '../../core/agent-config/agent-persona.service';
import type { LlmRouter } from '../ai-coach/llm/llm-router.service';
import type { LLMRequest, LLMResult } from '../ai-coach/llm/llm.types';
import { ValidationService } from './validation/validation.service';
import { WorkoutPresentationService } from './workout-presentation.service';

const content: ProtocolStructure = {
  promptVersion: 'v1',
  goal: 'GAIN_MUSCLE',
  phase: 'ADAPTACAO',
  phaseDurationWeeks: 3,
  weeklyFrequency: 3,
  sessions: [
    {
      dayLabel: 'Dia A',
      focus: 'Corpo inteiro',
      exercises: [
        {
          exerciseId: 'goblet_squat',
          name: 'Agachamento goblet',
          sets: 3,
          reps: { min: 8, max: 12 },
          loadStrategy: 'DOUBLE_PROGRESSION',
          restSeconds: 90,
        },
      ],
    },
  ],
};

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
  const service = new WorkoutPresentationService(llm, validation, agentPersona, logger);
  return { service, complete, persona };
}

const baseParams = {
  userId: 'u1',
  user: { name: 'Ana', phoneNumber: '+5541999999999', email: null },
  biologicalSex: 'FEMALE' as const,
  content,
  totalWeeks: 8,
  mesocycleName: 'Mesociclo 1: Adaptação',
  reason: 'INITIAL' as const,
};

describe('WorkoutPresentationService (achado 2026-09-04)', () => {
  it('gera e devolve o resumo quando a IA responde e passa na validação', async () => {
    const { service, complete, persona } = makeService({
      complete: async () => llmResult('Seu treino trabalha corpo inteiro 3x por semana.'),
    });
    const text = await service.present(baseParams);
    expect(text).toBe('Seu treino trabalha corpo inteiro 3x por semana.');
    expect(persona).toHaveBeenCalledWith('FEMALE');
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: 'AI_RESPONSE',
        userId: 'u1',
        intent: 'protocol_delivery_summary',
      }),
    );
  });

  /**
   * Achado 2026-09-09 (correção do fundador, regra de produto): travessão nunca deve
   * aparecer em mensagem do Coach. Esta é a única bolha gerada por LLM que ficava FORA do
   * `stripEmDash` de `response-formatter.ts` (reservado ao pipeline de chat) — o resumo saía
   * cru do modelo direto pro WhatsApp.
   */
  it('remove travessão da saída do LLM antes de devolver (mesma rede de segurança do chat)', async () => {
    const { service } = makeService({
      complete: async () =>
        llmResult('Seu treino trabalha corpo inteiro — 3x por semana, sem enrolação.'),
    });
    const text = await service.present(baseParams);
    expect(text).not.toContain('—');
    expect(text).toBe('Seu treino trabalha corpo inteiro, 3x por semana, sem enrolação.');
  });

  it('nunca lança — falha da LLM devolve undefined (bolha omitida)', async () => {
    const { service } = makeService({
      complete: async () => {
        throw new Error('todos os provedores falharam');
      },
    });
    await expect(service.present(baseParams)).resolves.toBeUndefined();
  });

  it('reprovado pelo ValidationService (guardrail de linguagem) devolve undefined', async () => {
    const { service } = makeService({
      complete: async () => llmResult('Isso é um diagnóstico do seu quadro.'),
      validationVerdict: 'BLOCK_FALLBACK',
    });
    await expect(service.present(baseParams)).resolves.toBeUndefined();
  });

  // Achado 2026-09-08 (bug reproduzido ao vivo pelo fundador): a reentrega pós-substituição
  // pedia a MESMA apresentação de "treino que acabou de ser entregue" da 1ª entrega — o
  // system prompt precisa deixar claro pro LLM que é uma ATUALIZAÇÃO, citando a troca.
  it('reason SUBSTITUTION pede confirmação de ATUALIZAÇÃO, citando a troca, não a 1ª entrega', async () => {
    const { service, complete } = makeService({
      complete: async () => llmResult('Troquei seu agachamento por outro exercício seguro.'),
    });
    await service.present({
      ...baseParams,
      reason: 'SUBSTITUTION',
      substitutionFrom: 'Agachamento Livre',
      substitutionTo: 'Agachamento Goblet',
    });
    const system = complete.mock.calls[0]?.[0]?.system ?? '';
    expect(system).toContain('Agachamento Livre');
    expect(system).toContain('Agachamento Goblet');
    expect(system).toContain('NÃO é a primeira entrega');
    // Tarefa da 1ª entrega ("...que apresenta...o treino que acabou de ser entregue") não
    // pode ser a mesma da reentrega por substituição ("...que confirma...a ATUALIZAÇÃO").
    expect(system).not.toContain('que apresenta, de forma simples e resumida, o treino');
  });
});

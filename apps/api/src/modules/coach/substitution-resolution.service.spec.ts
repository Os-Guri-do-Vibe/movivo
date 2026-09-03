import { describe, expect, it, vi } from 'vitest';
import type { PinoLogger } from 'nestjs-pino';

import type { LlmRouter } from '../ai-coach/llm/llm-router.service';
import { SubstitutionResolutionService } from './substitution-resolution.service';

const CANDIDATES = [
  { id: 'supino_reto_halter', name: 'Supino Reto (Halter)' },
  { id: 'flexao_diamante', name: 'Flexão Diamante' },
];

function make(text: string) {
  const complete = vi.fn().mockResolvedValue({ text, model: 'deepseek-v4-pro' });
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
  return {
    service: new SubstitutionResolutionService({ complete } as unknown as LlmRouter, logger),
    complete,
  };
}

function request(recentConversation: string) {
  return {
    userId: 'u1',
    operationId: 'op-1',
    user: {},
    recentConversation,
    targetExerciseName: 'Supino Reto (Barra)',
    candidates: CANDIDATES,
    personaSlot: null,
  };
}

describe('SubstitutionResolutionService', () => {
  it('resolve a confirmação com o id de um candidato recebido', async () => {
    const { service } = make(JSON.stringify({ chosenExerciseId: 'supino_reto_halter' }));
    const result = await service.resolve(
      request('MOVI: Que tal supino reto com halter?\nAluno: pode ser essa mesmo, vamos de halter'),
    );
    expect(result).toEqual({ resolved: true, chosenExerciseId: 'supino_reto_halter' });
  });

  it('id fora da lista de candidatos recebida (alucinação) é tratado como não resolvido', async () => {
    const { service } = make(JSON.stringify({ chosenExerciseId: 'agachamento_barra' }));
    const result = await service.resolve(request('Aluno: pode trocar'));
    expect(result).toEqual({ resolved: false });
  });

  it('chosenExerciseId null → não resolvido', async () => {
    const { service } = make(JSON.stringify({ chosenExerciseId: null }));
    const result = await service.resolve(request('Aluno: deixa eu pensar'));
    expect(result).toEqual({ resolved: false });
  });

  it('lista de candidatos vazia → não resolvido, sem chamar o LLM', async () => {
    const { service, complete } = make(JSON.stringify({ chosenExerciseId: 'supino_reto_halter' }));
    const result = await service.resolve({ ...request('Aluno: ok'), candidates: [] });
    expect(result).toEqual({ resolved: false });
    expect(complete).not.toHaveBeenCalled();
  });

  it('JSON malformado → não resolvido, sem lançar', async () => {
    const { service } = make('não é JSON');
    await expect(service.resolve(request('Aluno: oi'))).resolves.toEqual({ resolved: false });
  });

  it('falha do LLM → não resolvido, sem lançar', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('timeout'));
    const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
    const service = new SubstitutionResolutionService({ complete } as unknown as LlmRouter, logger);
    await expect(service.resolve(request('Aluno: oi'))).resolves.toEqual({ resolved: false });
  });
});

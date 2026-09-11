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
    const { service } = make(
      JSON.stringify({ chosenExerciseId: 'supino_reto_halter', rejectedAll: false }),
    );
    const result = await service.resolve(
      request('MOVI: Que tal supino reto com halter?\nAluno: pode ser essa mesmo, vamos de halter'),
    );
    expect(result).toEqual({ resolved: true, chosenExerciseId: 'supino_reto_halter' });
  });

  it('id fora da lista de candidatos recebida (alucinação) é tratado como não resolvido', async () => {
    const { service } = make(
      JSON.stringify({ chosenExerciseId: 'agachamento_barra', rejectedAll: false }),
    );
    const result = await service.resolve(request('Aluno: pode trocar'));
    expect(result).toEqual({ resolved: false, rejectedAll: false });
  });

  it('chosenExerciseId null → não resolvido', async () => {
    const { service } = make(JSON.stringify({ chosenExerciseId: null, rejectedAll: false }));
    const result = await service.resolve(request('Aluno: deixa eu pensar'));
    expect(result).toEqual({ resolved: false, rejectedAll: false });
  });

  it('lista de candidatos vazia → não resolvido, sem chamar o LLM', async () => {
    const { service, complete } = make(
      JSON.stringify({ chosenExerciseId: 'supino_reto_halter', rejectedAll: false }),
    );
    const result = await service.resolve({ ...request('Aluno: ok'), candidates: [] });
    expect(result).toEqual({ resolved: false, rejectedAll: false });
    expect(complete).not.toHaveBeenCalled();
  });

  it('JSON malformado → não resolvido, sem lançar', async () => {
    const { service } = make('não é JSON');
    await expect(service.resolve(request('Aluno: oi'))).resolves.toEqual({
      resolved: false,
      rejectedAll: false,
    });
  });

  it('falha do LLM → não resolvido, sem lançar', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('timeout'));
    const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
    const service = new SubstitutionResolutionService({ complete } as unknown as LlmRouter, logger);
    await expect(service.resolve(request('Aluno: oi'))).resolves.toEqual({
      resolved: false,
      rejectedAll: false,
    });
  });

  // Achado 2026-09-08 (bug reproduzido ao vivo pelo fundador): aluno recusa TODAS as opções
  // oferecidas e insiste noutro exercício fora da base — distinto de só não ter decidido
  // ainda. Sem essa distinção, a IA caía num caminho generativo livre que às vezes
  // "prometia" registrar sem que nada fosse persistido de verdade.
  it('rejectedAll true quando o aluno recusa tudo e insiste noutro exercício', async () => {
    const { service } = make(JSON.stringify({ chosenExerciseId: null, rejectedAll: true }));
    const result = await service.resolve(
      request('Aluno: nenhuma dessas, queria o supino reto na máquina mesmo'),
    );
    expect(result).toEqual({ resolved: false, rejectedAll: true });
  });

  it('resposta sem o campo rejectedAll (schema estrito) → tratado como falha de parse, não resolvido', async () => {
    const { service } = make(JSON.stringify({ chosenExerciseId: null }));
    const result = await service.resolve(request('Aluno: não gostei'));
    expect(result).toEqual({ resolved: false, rejectedAll: false });
  });

  // Achado 2026-09-08: "posso trocar X por [substituto]?" nomeia o pedido e a escolha na
  // MESMA mensagem — checado ANTES do teto de exibição, contra o universo completo de
  // candidatos seguros, pra não depender de o Coach já ter oferecido opções antes.
  describe('resolveExplicitRequest', () => {
    it('resolve um substituto citado explicitamente pelo aluno, mesmo sem oferta prévia', async () => {
      const { service, complete } = make(JSON.stringify({ chosenExerciseId: 'flexao_diamante' }));
      const result = await service.resolveExplicitRequest(
        request('Aluno: não gostei do supino, posso trocar por flexão diamante?'),
      );
      expect(result).toEqual({ resolved: true, chosenExerciseId: 'flexao_diamante' });
      const system = complete.mock.calls[0]?.[0]?.system ?? '';
      expect(system).not.toContain('já ofereceu opções');
      expect(complete.mock.calls[0]?.[0]?.intent).toBe('substitution_explicit_request');
    });

    it('id fora da lista de candidatos recebida (alucinação) é tratado como não resolvido', async () => {
      const { service } = make(JSON.stringify({ chosenExerciseId: 'agachamento_barra' }));
      const result = await service.resolveExplicitRequest(request('Aluno: pode trocar'));
      expect(result).toEqual({ resolved: false });
    });

    it('chosenExerciseId null (pedido sem nomear substituto) → não resolvido', async () => {
      const { service } = make(JSON.stringify({ chosenExerciseId: null }));
      const result = await service.resolveExplicitRequest(request('Aluno: não gosto desse exercício'));
      expect(result).toEqual({ resolved: false });
    });

    it('lista de candidatos vazia → não resolvido, sem chamar o LLM', async () => {
      const { service, complete } = make(JSON.stringify({ chosenExerciseId: 'flexao_diamante' }));
      const result = await service.resolveExplicitRequest({ ...request('Aluno: ok'), candidates: [] });
      expect(result).toEqual({ resolved: false });
      expect(complete).not.toHaveBeenCalled();
    });

    it('JSON malformado → não resolvido, sem lançar', async () => {
      const { service } = make('não é JSON');
      await expect(service.resolveExplicitRequest(request('Aluno: oi'))).resolves.toEqual({
        resolved: false,
      });
    });
  });
});

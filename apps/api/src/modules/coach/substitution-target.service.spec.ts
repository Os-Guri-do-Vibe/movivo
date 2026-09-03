import { describe, expect, it, vi } from 'vitest';
import type { PinoLogger } from 'nestjs-pino';

import type { LlmRouter } from '../ai-coach/llm/llm-router.service';
import { SubstitutionTargetService, type ProtocolExerciseRef } from './substitution-target.service';

const PROTOCOL_EXERCISES: ProtocolExerciseRef[] = [
  { id: 'flexao', name: 'Flexão' },
  { id: 'agachamento_peso_corporal', name: 'Agachamento (Peso Corporal)' },
];

function make(text: string) {
  const complete = vi.fn().mockResolvedValue({ text, model: 'deepseek-v4-pro' });
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
  return {
    service: new SubstitutionTargetService({ complete } as unknown as LlmRouter, logger),
    complete,
  };
}

function request(recentConversation: string) {
  return {
    userId: 'u1',
    operationId: 'op-1',
    user: {},
    recentConversation,
    protocolExercises: PROTOCOL_EXERCISES,
    personaSlot: null,
  };
}

describe('SubstitutionTargetService', () => {
  it('identifica o exercício quando o id retornado está na lista recebida', async () => {
    const { service } = make(JSON.stringify({ exerciseId: 'flexao' }));
    const result = await service.identify(request('não gosto de fazer flexão, me sinto insegura'));
    expect(result).toEqual({ identified: true, exerciseId: 'flexao' });
  });

  it('id fora da lista recebida (alucinação) é tratado como não identificado', async () => {
    const { service } = make(JSON.stringify({ exerciseId: 'exercicio_que_nao_existe' }));
    const result = await service.identify(request('quero trocar um exercício'));
    expect(result).toEqual({ identified: false });
  });

  it('exerciseId null → não identificado', async () => {
    const { service } = make(JSON.stringify({ exerciseId: null }));
    const result = await service.identify(request('tô sem vontade de treinar hoje'));
    expect(result).toEqual({ identified: false });
  });

  it('JSON malformado → não identificado, sem lançar', async () => {
    const { service } = make('isso não é JSON');
    await expect(service.identify(request('oi'))).resolves.toEqual({ identified: false });
  });

  it('falha do LLM → não identificado, sem lançar', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('provedor indisponível'));
    const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
    const service = new SubstitutionTargetService({ complete } as unknown as LlmRouter, logger);
    await expect(service.identify(request('oi'))).resolves.toEqual({ identified: false });
  });

  it('lista de exercícios vazia → não identificado, sem chamar o LLM', async () => {
    const { service, complete } = make(JSON.stringify({ exerciseId: 'flexao' }));
    const result = await service.identify({ ...request('oi'), protocolExercises: [] });
    expect(result).toEqual({ identified: false });
    expect(complete).not.toHaveBeenCalled();
  });

  // Achado 2026-09-02 (reproduzido ao vivo): a última mensagem de um turno de continuação
  // ("é insegurança mesmo, sem dor") não cita exercício nenhum sozinha — só a conversa
  // completa permite identificar o alvo. A requisição carrega a janela de conversa inteira
  // (não só a última mensagem), e é isso que o teste trava.
  it('identifica o alvo usando a conversa inteira, não só a última mensagem isolada', async () => {
    const { service, complete } = make(JSON.stringify({ exerciseId: 'flexao' }));
    const conversation =
      'Aluno: aquela flexão do meu treino me deixa inseguro, tenho medo de me machucar\n' +
      'MOVI: entendo, é dor ou insegurança sem sintoma?\n' +
      'Aluno: é insegurança mesmo, sem dor nenhuma';
    const result = await service.identify(request(conversation));
    expect(result).toEqual({ identified: true, exerciseId: 'flexao' });
    expect(complete.mock.calls[0]?.[0]?.messages[0]?.content).toContain('insegurança mesmo');
  });
});

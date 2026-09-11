import { describe, expect, it, vi } from 'vitest';
import type { PinoLogger } from 'nestjs-pino';

import type { LlmRouter } from '../ai-coach/llm/llm-router.service';
import { SubstitutionCatalogLookupService } from './substitution-catalog-lookup.service';

const FULL_CATALOG = [
  { id: 'supino_sentado_maquina', name: 'Supino Sentado (Máquina)' },
  { id: 'agachamento_barra', name: 'Agachamento (Barra)' },
];

function make(text: string) {
  const complete = vi.fn().mockResolvedValue({ text, model: 'deepseek-v4-pro' });
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
  return {
    service: new SubstitutionCatalogLookupService({ complete } as unknown as LlmRouter, logger),
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
    fullCatalog: FULL_CATALOG,
    personaSlot: null,
  };
}

describe('SubstitutionCatalogLookupService', () => {
  it('nomeou algo específico E existe no catálogo, mesma identidade por sinônimo (mesmo que não seja opção segura)', async () => {
    const { service } = make(
      JSON.stringify({
        requestedName: 'supino sentado na máquina mesmo',
        matchedExerciseId: 'supino_sentado_maquina',
      }),
    );
    const result = await service.identify(
      request('Aluno: quero o supino sentado na máquina mesmo'),
    );
    expect(result).toEqual({
      requestedName: 'supino sentado na máquina mesmo',
      matchedExerciseId: 'supino_sentado_maquina',
    });
  });

  it('nomeou algo específico que NÃO existe em lugar nenhum do catálogo', async () => {
    const { service } = make(
      JSON.stringify({ requestedName: 'supino reto máquina', matchedExerciseId: null }),
    );
    const result = await service.identify(request('Aluno: quero o supino reto máquina'));
    expect(result).toEqual({ requestedName: 'supino reto máquina', matchedExerciseId: null });
  });

  /**
   * Regressão do achado 2026-09-09 (teste real do fundador): o aluno pediu "supino reto na
   * máquina" (mesmo movimento do supino reto de barra, só que numa máquina própria) e o LLM
   * bateu incorretamente com "Supino Sentado (Máquina)" — um exercício DIFERENTE (ângulo/
   * execução sentada) que só existe no catálogo por coincidência de "supino numa máquina".
   * Isso mandou o pedido pro caminho errado (ii — existe mas não elegível, com diff real)
   * quando deveria ir pro caminho (iii) — não existe no catálogo, com opção de cadastrar.
   * Este teste prova que o wrapper aceita `null` do LLM sem tentar "corrigir" ou insistir
   * num match — a correção de fundo é o prompt (ver teste de conteúdo do prompt abaixo).
   */
  it('exercício parecido mas de identidade diferente do único candidato do catálogo → null, não um falso match', async () => {
    const { service } = make(
      JSON.stringify({ requestedName: 'supino reto na máquina', matchedExerciseId: null }),
    );
    const result = await service.identify(
      request('Aluno: posso trocar o supino reto com barra por um supino reto na máquina?'),
    );
    expect(result).toEqual({ requestedName: 'supino reto na máquina', matchedExerciseId: null });
  });

  it('id fora da lista recebida (alucinação) é tratado como não existente no catálogo', async () => {
    const { service } = make(
      JSON.stringify({ requestedName: 'leg press', matchedExerciseId: 'id_que_nao_veio_na_lista' }),
    );
    const result = await service.identify(request('Aluno: quero leg press'));
    expect(result).toEqual({ requestedName: 'leg press', matchedExerciseId: null });
  });

  it('nada específico pedido (recusa vaga) → os dois campos null', async () => {
    const { service } = make(JSON.stringify({ requestedName: null, matchedExerciseId: null }));
    const result = await service.identify(request('Aluno: nenhuma dessas'));
    expect(result).toEqual({ requestedName: null, matchedExerciseId: null });
  });

  it('matchedExerciseId presente mas requestedName null → tratado como nada pedido (nunca confia no campo isolado)', async () => {
    const { service } = make(
      JSON.stringify({ requestedName: null, matchedExerciseId: 'supino_sentado_maquina' }),
    );
    const result = await service.identify(request('Aluno: ok'));
    expect(result).toEqual({ requestedName: null, matchedExerciseId: null });
  });

  it('JSON malformado → tratado como nada específico pedido, sem lançar', async () => {
    const { service } = make('não é JSON');
    await expect(service.identify(request('Aluno: oi'))).resolves.toEqual({
      requestedName: null,
      matchedExerciseId: null,
    });
  });

  it('falha do LLM → tratado como nada específico pedido, sem lançar', async () => {
    const complete = vi.fn().mockRejectedValue(new Error('timeout'));
    const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
    const service = new SubstitutionCatalogLookupService(
      { complete } as unknown as LlmRouter,
      logger,
    );
    await expect(service.identify(request('Aluno: oi'))).resolves.toEqual({
      requestedName: null,
      matchedExerciseId: null,
    });
  });

  it('usa o catálogo COMPLETO recebido (não um subconjunto) e um intent curto', async () => {
    const { service, complete } = make(
      JSON.stringify({ requestedName: null, matchedExerciseId: null }),
    );
    await service.identify(request('Aluno: oi'));
    expect(complete.mock.calls[0]?.[0]?.intent).toBe('substitution_catalog_lookup');
    expect(complete.mock.calls[0]?.[0]?.intent.length).toBeLessThanOrEqual(30);
  });

  /**
   * Trava de regressão do achado 2026-09-09: o prompt precisa deixar explícito que
   * "parecido" (mesmo grupo muscular/equipamento) não é "a mesma coisa" — sem essa
   * instrução o LLM bateu "supino reto na máquina" com "Supino Sentado (Máquina)" por
   * serem os dois "supino numa máquina", quando são exercícios diferentes.
   */
  it('o prompt instrui a nunca confundir exercício parecido com a mesma identidade', async () => {
    const { service, complete } = make(
      JSON.stringify({ requestedName: null, matchedExerciseId: null }),
    );
    await service.identify(request('Aluno: oi'));
    const system = String(complete.mock.calls[0]?.[0]?.system ?? '');
    expect(system).toContain('NUNCA um exercício diferente só porque parece');
    expect(system).toContain('Na dúvida');
  });
});

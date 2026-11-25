import { describe, expect, it, vi } from 'vitest';

import { ConversationOrchestrator } from './orchestrator.service';

/** Só o fluxo de atualização de registros é exercitado: o resto do orquestrador fica de fora. */
function build(result: { status: string; reply: string; unsupported: string | null }) {
  const openCase = vi.fn().mockResolvedValue(undefined);
  const handle = vi.fn().mockResolvedValue(result);
  const orchestrator = Object.create(ConversationOrchestrator.prototype) as Record<string, unknown>;
  orchestrator.records = { handle };
  orchestrator.openCase = openCase;
  const recordUpdate = () =>
    (
      orchestrator as unknown as {
        recordUpdate: (u: string, t: string, n: Date, i: string) => Promise<unknown>;
      }
    ).recordUpdate.call(orchestrator, 'user-1', 'texto', new Date(), 'RECORD_UPDATE');
  return { recordUpdate, openCase, handle };
}

describe('atualização de registros pelo chat', () => {
  it('registro corrigido responde ao aluno e não ocupa a equipe', async () => {
    const { recordUpdate, openCase } = build({
      status: 'EXECUTED',
      reply: 'Pronto, atualizei:\n- Supino, série 3: de 30 kg para 40 kg',
      unsupported: null,
    });
    expect(await recordUpdate()).toEqual({
      status: 'EXECUTED',
      reply: 'Pronto, atualizei:\n- Supino, série 3: de 30 kg para 40 kg',
      intent: 'RECORD_UPDATE',
    });
    expect(openCase).not.toHaveBeenCalled();
  });

  it('o que o chat não altera vira caso para a equipe', async () => {
    const { recordUpdate, openCase } = build({
      status: 'INFORMED',
      reply: 'Sobre o seu objetivo: passei para a equipe.',
      unsupported: 'o seu objetivo',
    });
    expect(await recordUpdate()).toMatchObject({ status: 'ESCALATED', intent: 'RECORD_UPDATE' });
    expect(openCase).toHaveBeenCalledOnce();
    expect(openCase.mock.calls[0]?.[3]).toMatch(/o seu objetivo/);
  });

  it('parte corrigida e parte fora do alcance: corrige e também avisa a equipe', async () => {
    const { recordUpdate, openCase } = build({
      status: 'EXECUTED',
      reply: 'Pronto, atualizei...',
      unsupported: 'os dias de treino',
    });
    expect(await recordUpdate()).toMatchObject({ status: 'EXECUTED' });
    expect(openCase).toHaveBeenCalledOnce();
  });
});

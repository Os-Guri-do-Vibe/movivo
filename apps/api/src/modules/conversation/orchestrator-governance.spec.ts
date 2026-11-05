import { describe, expect, it, vi } from 'vitest';

import { ForbiddenTopicsUnavailableError } from '../../core/attendance-rules/forbidden-topics.service';
import * as msg from './messages';
import { ConversationOrchestrator } from './orchestrator.service';

/** Só a governança (tema proibido e FAQ) é exercitada: o resto do orquestrador fica de fora. */
function build(overrides: { forbidden?: unknown; faq?: unknown }) {
  const openCase = vi.fn().mockResolvedValue(undefined);
  const orchestrator = Object.create(ConversationOrchestrator.prototype) as Record<string, unknown>;
  orchestrator.forbiddenTopics = overrides.forbidden ?? {
    evaluate: vi.fn().mockResolvedValue(null),
  };
  orchestrator.faq = overrides.faq ?? { match: vi.fn().mockResolvedValue(null) };
  orchestrator.openCase = openCase;
  const governance = (text: string) =>
    (
      orchestrator as unknown as {
        governance: (userId: string, text: string) => Promise<unknown>;
      }
    ).governance.call(orchestrator, 'user-1', text);
  return { governance, openCase };
}

describe('governança do atendimento', () => {
  it('tema proibido encerra a conversa e abre caso para a equipe', async () => {
    const { governance, openCase } = build({
      forbidden: {
        evaluate: vi.fn().mockResolvedValue({ topicKey: 't', label: 'Suplementos', version: 1 }),
      },
    });
    expect(await governance('qual creatina comprar?')).toEqual({
      status: 'ESCALATED',
      reply: msg.FORBIDDEN_TOPIC_MESSAGE,
    });
    expect(openCase).toHaveBeenCalledOnce();
  });

  it('sem a lista de temas, responde de forma segura e não gera nada', async () => {
    const { governance } = build({
      forbidden: { evaluate: vi.fn().mockRejectedValue(new ForbiddenTopicsUnavailableError()) },
    });
    expect(await governance('oi')).toEqual({ status: 'ESCALATED', reply: msg.FALLBACK_MESSAGE });
  });

  it('FAQ publicado responde sem chamar o modelo', async () => {
    const { governance, openCase } = build({
      faq: { match: vi.fn().mockResolvedValue({ answer: 'Treinamos 3x por semana.' }) },
    });
    expect(await governance('quantas vezes treino?')).toEqual({
      status: 'ANSWERED',
      reply: 'Treinamos 3x por semana.',
      intent: 'FAQ',
    });
    expect(openCase).not.toHaveBeenCalled();
  });

  it('sem tema nem FAQ, segue para a classificação', async () => {
    expect(await build({}).governance('bom dia')).toBeNull();
  });

  it('erro inesperado na lista de temas não é engolido', async () => {
    const { governance } = build({
      forbidden: { evaluate: vi.fn().mockRejectedValue(new Error('boom')) },
    });
    await expect(governance('oi')).rejects.toThrow('boom');
  });
});

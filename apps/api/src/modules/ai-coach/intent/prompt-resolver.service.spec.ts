/**
 * TASK-7.9.3 — propagação do nome da agente e golden set de "conversa verde".
 *
 * Dois cenários que os testes existentes não cobriam: (1) renomear a agente no painel tem
 * que aparecer no prompt do coach, nas mensagens estáticas de WhatsApp/assinatura e na
 * recusa de fora-de-escopo — os três caminhos que hoje passam por `agentName()`; (2) por
 * mais que a persona mude, o texto que chega ao aluno nunca pode conter linguagem clínica
 * vedada, e o prompt nunca pode perder os blocos L0.
 */
import { DEFAULT_AGENT_PERSONA, type AgentPersona } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import type { AgentPersonaService } from '../../../core/agent-config/agent-persona.service';
import { conversionMessage } from '../../subscription/subscription-messages';
import { formatProtocolDelivery } from '../../whatsapp/message-templates';
import { INTENTS } from './intent.types';
import { PromptResolverService } from './prompt-resolver.service';
import { INVIOLABLE_RULES_BLOCK, SCOPE_PERIMETER_BLOCK } from './prompts';

const PROTOCOL = {
  sessions: [
    {
      focus: 'Corpo inteiro',
      exercises: [
        {
          name: 'Agachamento livre',
          sets: 3,
          reps: { min: 8, max: 12 },
          loadStrategy: 'DOUBLE_PROGRESSION',
          restSeconds: 90,
        },
      ],
    },
  ],
} as unknown as Parameters<typeof formatProtocolDelivery>[0];

/** Personas válidas (espaço fechado do schema) usadas no golden set. */
const PERSONAS: AgentPersona[] = [
  DEFAULT_AGENT_PERSONA,
  { ...DEFAULT_AGENT_PERSONA, agentName: 'ATLAS' },
  {
    ...DEFAULT_AGENT_PERSONA,
    agentName: 'Nina',
    toneDescriptors: ['formal', 'tecnico'],
    emojiPolicy: 'NENHUM',
    personaTraits: ['EXPLICA_O_PORQUE', 'UMA_PERGUNTA_POR_VEZ'],
  },
];

/** Termos vedados (CLAUDE.md) por fronteira de palavra: "procurar" contém "cura". */
const FORBIDDEN = [/\bdiagn[óo]stico\b/i, /\btratamento\b/i, /\bcura\b/i, /resultado\s+garantid/i];

function resolver(persona: AgentPersona): PromptResolverService {
  return new PromptResolverService(
    {
      persona: async () => persona,
      agentName: async () => persona.agentName,
    } as unknown as AgentPersonaService,
    { activeLabels: async () => [] } as never,
  );
}

/** Textos que o aluno de fato lê, para uma persona qualquer. */
async function userFacingTexts(persona: AgentPersona): Promise<string[]> {
  return [
    await resolver(persona).foraDeEscopoResponse(),
    formatProtocolDelivery(PROTOCOL, 'https://movivo.test/protocolo/abc', persona.agentName),
    ...(['day7', 'day10', 'day13', 'day14', 'winback'] as const).map((key) =>
      conversionMessage(key, 'https://movivo.test/checkout', persona.agentName),
    ),
  ];
}

describe('renomear a agente propaga (TASK-7.9.3)', () => {
  const persona = { ...DEFAULT_AGENT_PERSONA, agentName: 'ATLAS' };

  it('chega ao system prompt do coach', async () => {
    expect(await resolver(persona).resolvePrompt('DUVIDA_TECNICA')).toContain('ATLAS');
  });

  it('chega à recusa de fora-de-escopo', async () => {
    expect(await resolver(persona).foraDeEscopoResponse()).toContain('ATLAS');
  });

  it('chega às mensagens estáticas de WhatsApp e de assinatura', () => {
    expect(formatProtocolDelivery(PROTOCOL, 'https://x/p/1', 'ATLAS')).toContain('ATLAS');
    expect(conversionMessage('day14', 'https://x/c', 'ATLAS')).toContain('ATLAS');
  });

  it('nenhum texto ao aluno carrega o nome antigo depois da troca', async () => {
    for (const text of await userFacingTexts(persona)) expect(text).not.toContain('MOVI');
  });
});

describe('golden set de conversa verde (TASK-7.9.3)', () => {
  it('nenhuma persona válida faz um texto ao aluno usar linguagem clínica vedada', async () => {
    for (const persona of PERSONAS) {
      for (const text of await userFacingTexts(persona)) {
        for (const term of FORBIDDEN) expect(text).not.toMatch(term);
      }
    }
  });

  it('o respaldo do profissional CREF continua visível na entrega do protocolo', () => {
    for (const persona of PERSONAS) {
      expect(formatProtocolDelivery(PROTOCOL, 'https://x/p/1', persona.agentName)).toMatch(/CREF/);
    }
  });

  it('todo prompt mantém os dois blocos L0, qualquer que seja a persona', async () => {
    for (const persona of PERSONAS) {
      for (const intent of INTENTS) {
        const prompt = await resolver(persona).resolvePrompt(intent);
        expect(prompt).toContain(SCOPE_PERIMETER_BLOCK);
        expect(prompt).toContain(INVIOLABLE_RULES_BLOCK);
      }
    }
  });
});

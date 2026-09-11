import { DEFAULT_AGENT_PERSONA, type AgentPersona, type ProtocolStructure } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import {
  analyzingMessage,
  BUBBLE_SEPARATOR,
  confirmationCareMessage,
  confirmationMessage,
  formatProtocolDelivery,
  protocolDeliveryPdfText,
  PROTOCOL_WAITING_DELAY_MS,
} from './message-templates';

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

const PERSONA = DEFAULT_AGENT_PERSONA;
const NO_EMOJI: AgentPersona = { ...DEFAULT_AGENT_PERSONA, emojiPolicy: 'NENHUM' };

const delivery = (persona: AgentPersona = PERSONA) =>
  formatProtocolDelivery(content, 'https://x/protocolo/abc', persona, 8, 'Mesociclo 1: Adaptação');

/** Guardrails inegociáveis (CLAUDE.md / Sofia §13): a copy nunca pode conter estes termos. */
const FORBIDDEN = /diagn[óo]stico|tratamento|\bcura\b|garantid|garantia|prescri/i;

const allTexts = [
  confirmationMessage('Ana'),
  confirmationCareMessage(),
  analyzingMessage(PERSONA),
  analyzingMessage(NO_EMOJI),
  delivery(),
  delivery(NO_EMOJI),
  protocolDeliveryPdfText('Ana'),
  protocolDeliveryPdfText(null),
  protocolDeliveryPdfText('Ana', 'Seu treino trabalha corpo inteiro 3x por semana.'),
  // Achado 2026-09-09 (bug reproduzido ao vivo pelo fundador): a saudação de reentrega
  // pós-substituição tinha um travessão que escapou da checagem por não ter cobertura
  // aqui — este é exatamente o caminho onde ele apareceu, por isso entra na varredura.
  protocolDeliveryPdfText('Rodrigo', undefined, {
    from: 'Supino Reto (Barra)',
    to: 'Supino Reto (Máquina)',
  }),
];

describe('templates de WhatsApp (US-2.5)', () => {
  it('nenhuma copy contém termo proibido', () => {
    for (const text of allTexts) expect(text).not.toMatch(FORBIDDEN);
  });

  /**
   * Regra de produto (achado 2026-09-09, correção do fundador): o Agente IA Coach do
   * WhatsApp nunca usa travessão "—" em nenhuma mensagem, nem nas fixas/determinísticas
   * como estas. Mesma motivação de `EM_DASH`/`stripEmDash` em `response-formatter.ts`
   * (que cobre a saída LIVRE do LLM) — esta varredura cobre a copy FIXA, que não passa
   * por aquele pipeline.
   */
  it('nenhuma copy fixa usa travessão (—)', () => {
    for (const text of allTexts) expect(text).not.toContain('—');
  });

  // `confirmationMessage` é uma exceção deliberada ao guardrail geral de citar o CREF
  // (ver comentário na função, `message-templates.ts`) — não entra nesta checagem.
  it('variante de cuidado e entrega do protocolo citam o CREF', () => {
    expect(confirmationCareMessage()).toMatch(/CREF/);
    expect(delivery()).toMatch(/CREF/);
  });

  it('variante de cuidado não promete plano automático', () => {
    expect(confirmationCareMessage()).toMatch(/revisar/i);
    expect(confirmationCareMessage()).not.toMatch(/2 horas|em até 2h/i);
  });

  it('confirma sincronamente sem prometer prazo operacional', () => {
    expect(confirmationMessage('Ana')).toMatch(/Recebemos suas informações/i);
    expect(confirmationMessage('Ana')).not.toMatch(/2 horas|em até 2h|prazo/i);
  });

  it('confirmação saúda pelo primeiro nome quando disponível, e genericamente quando não', () => {
    expect(confirmationMessage('Ana')).toMatch(/^Olá, Ana!/);
    expect(confirmationMessage(null)).toMatch(/^Olá!/);
  });

  it('entrega quebra em bolhas, explica o plano, destaca o 1º treino e inclui o link', () => {
    const bubbles = delivery().split(BUBBLE_SEPARATOR);
    expect(bubbles.length).toBe(4);
    expect(bubbles[0]).toMatch(/intelig[êe]ncia artificial/i); // transparência de IA
    expect(bubbles[2]).toContain('Corpo inteiro');
    expect(bubbles[2]).toContain('Agachamento goblet: 3x8-12 (descanso 1 min 30 s)');
    expect(bubbles[3]).toContain('https://x/protocolo/abc');
  });

  it('o bloco de explicação nomeia o mesociclo, a duração e o rótulo do objetivo', () => {
    const explanation = delivery().split(BUBBLE_SEPARATOR)[1] ?? '';
    expect(explanation).toContain('Mesociclo 1: Adaptação');
    expect(explanation).toContain('8 semanas');
    // Rótulo humano do objetivo, nunca o enum cru (`GAIN_MUSCLE`).
    expect(explanation).toContain('Hipertrofia');
    expect(explanation).not.toContain('GAIN_MUSCLE');
    expect(explanation).toMatch(/check-in semanal/i);
  });

  it('entrega COM PDF: saúda pelo primeiro nome (achado 2026-09-04)', () => {
    expect(protocolDeliveryPdfText('Ana')).toBe(
      'Ana, seu treino está pronto! 💚🔥\n\n' +
        'Montamos tudo com base nos seus objetivos, na sua rotina e nas informações que ' +
        'você compartilhou com a gente.',
    );
    expect(protocolDeliveryPdfText(null)).toMatch(/^Seu treino está pronto! 💚🔥/);
  });

  it('entrega COM PDF: sem resumo de IA é 1 bolha; com resumo vira 2 bolhas', () => {
    expect(protocolDeliveryPdfText('Ana').split(BUBBLE_SEPARATOR)).toHaveLength(1);
    const withSummary = protocolDeliveryPdfText('Ana', 'Resumo curto do treino.');
    const bubbles = withSummary.split(BUBBLE_SEPARATOR);
    expect(bubbles).toHaveLength(2);
    expect(bubbles[1]).toBe('Resumo curto do treino.');
  });
});

describe('analyzingMessage — apresentação 30min após o submit', () => {
  it('o atraso é de 30 minutos', () => {
    expect(PROTOCOL_WAITING_DELAY_MS).toBe(30 * 60 * 1000);
  });

  it('é a apresentação do agente configurada no painel, verbatim, independente de reviewUrgency', () => {
    // Achado 2026-09-04 (a pedido do fundador): mandatory e optional mandavam textos
    // diferentes — a variante MANDATORY chegou a sair pro fundador em teste quando o
    // esperado era a apresentação normal. Unificado: um texto só, sempre `agentSelfIntro`.
    const persona: AgentPersona = {
      ...PERSONA,
      agentName: 'ATLAS',
      agentSelfIntro: 'Oi! Sou a ATLAS.\n\nJá recebi suas informações.',
    };
    const text = analyzingMessage(persona);
    // `agentSelfIntro` é a mensagem estática inteira — sai como veio do painel, sem
    // prefixo "Sou {nome}." nem qualquer outra transformação.
    expect(text).toBe('Oi! Sou a ATLAS.\n\nJá recebi suas informações.');
    expect(text).not.toMatch(/intelig[êe]ncia artificial/i);
    expect(text).not.toMatch(/já estou analisando/i);
  });

  it('a entrega do protocolo respeita a mesma política de emoji', () => {
    expect(delivery(NO_EMOJI)).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(delivery(NO_EMOJI)).not.toMatch(/ {2}/);
  });
});

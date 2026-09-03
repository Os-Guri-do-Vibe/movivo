import { DEFAULT_AGENT_PERSONA, type AgentPersona, type ProtocolStructure } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import {
  analyzingMessage,
  BUBBLE_SEPARATOR,
  confirmationCareMessage,
  confirmationMessage,
  formatProtocolDelivery,
  protocolDeliveryText,
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
  formatProtocolDelivery(content, 'https://x/protocolo/abc', persona, 8, 'Mesociclo 1 — Adaptação');

const deliveryWithPdf = (persona: AgentPersona = PERSONA) =>
  protocolDeliveryText(content, persona, 8, 'Mesociclo 1 — Adaptação');

/** Guardrails inegociáveis (CLAUDE.md / Sofia §13): a copy nunca pode conter estes termos. */
const FORBIDDEN = /diagn[óo]stico|tratamento|\bcura\b|garantid|garantia|prescri/i;

const allTexts = [
  confirmationMessage(),
  confirmationCareMessage(),
  analyzingMessage(PERSONA, { mandatory: false }),
  analyzingMessage(PERSONA, { mandatory: true }),
  analyzingMessage(NO_EMOJI, { mandatory: false }),
  delivery(),
  delivery(NO_EMOJI),
  deliveryWithPdf(),
];

describe('templates de WhatsApp (US-2.5)', () => {
  it('nenhuma copy contém termo proibido', () => {
    for (const text of allTexts) expect(text).not.toMatch(FORBIDDEN);
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
    expect(confirmationMessage()).toMatch(/Recebemos seus dados/i);
    expect(confirmationMessage()).not.toMatch(/2 horas|em até 2h|prazo/i);
  });

  it('entrega quebra em bolhas, explica o plano, destaca o 1º treino e inclui o link', () => {
    const bubbles = delivery().split(BUBBLE_SEPARATOR);
    expect(bubbles.length).toBe(4);
    expect(bubbles[0]).toMatch(/intelig[êe]ncia artificial/i); // transparência de IA
    expect(bubbles[2]).toContain('Corpo inteiro');
    expect(bubbles[2]).toContain('Agachamento goblet — 3x8-12 (descanso 90s)');
    expect(bubbles[3]).toContain('https://x/protocolo/abc');
  });

  it('o bloco de explicação nomeia o mesociclo, a duração e o rótulo do objetivo', () => {
    const explanation = delivery().split(BUBBLE_SEPARATOR)[1] ?? '';
    expect(explanation).toContain('Mesociclo 1 — Adaptação');
    expect(explanation).toContain('8 semanas');
    // Rótulo humano do objetivo, nunca o enum cru (`GAIN_MUSCLE`).
    expect(explanation).toContain('Hipertrofia');
    expect(explanation).not.toContain('GAIN_MUSCLE');
    expect(explanation).toMatch(/check-in semanal/i);
  });

  // Achado 2026-08-25: com PDF, o anexo JÁ é o plano completo — repetir o primeiro
  // treino em texto e oferecer um link "pra ver o plano completo" ao lado do PDF real
  // é redundante, não didático. O texto vira só intro + contexto.
  it('entrega COM PDF: só intro + contexto, sem prévia de treino nem link (o PDF é o plano)', () => {
    const bubbles = deliveryWithPdf().split(BUBBLE_SEPARATOR);
    expect(bubbles.length).toBe(2);
    expect(bubbles[0]).toMatch(/intelig[êe]ncia artificial/i);
    expect(bubbles[1]).toContain('Mesociclo 1 — Adaptação');
    expect(bubbles[1]).toContain('Hipertrofia');
    const whole = deliveryWithPdf();
    expect(whole).not.toContain('Corpo inteiro');
    expect(whole).not.toContain('Agachamento goblet');
    expect(whole).not.toMatch(/https?:\/\//);
  });
});

describe('analyzingMessage — apresentação 30min após o submit', () => {
  it('o atraso é de 30 minutos', () => {
    expect(PROTOCOL_WAITING_DELAY_MS).toBe(30 * 60 * 1000);
  });

  it('se apresenta com o nome e a auto-apresentação da persona vigente, declarando ser IA', () => {
    const text = analyzingMessage({ ...PERSONA, agentName: 'ATLAS' }, { mandatory: false });
    expect(text).toContain('Sou ATLAS.');
    // Primeira letra maiúscula (frase própria) — conteúdo é o mesmo, só capitalizado.
    expect(text.toLowerCase()).toContain(PERSONA.agentSelfIntro.toLowerCase());
    expect(text).toMatch(/analisando as informações/i);
    // Primeiro contato da agente: precisa declarar ser IA de forma explícita (achado de
    // QA 2026-08-25 — não bastava "montado com IA", o titular podia achar que é humano).
    expect(text).toMatch(/sou uma intelig[êe]ncia artificial/i);
  });

  it('nome com forma gramatical diferente do default não quebra a frase (achado de QA 2026-08-25)', () => {
    // Persona real publicada em produção: nome masculino + auto-apresentação em 1ª
    // pessoa já completa — bem diferente do fragmento em 3ª pessoa do default. A
    // construção antiga ("Aqui é a {nome}, {intro}") travava artigo feminino e virava
    // emenda por vírgula aqui. Trava de regressão: nunca mais "Aqui é a <nome masculino>".
    const persona: AgentPersona = {
      ...PERSONA,
      agentName: 'Leonardo',
      agentSelfIntro: 'Olá, sou o Leonardo, seu treinador da Movivo!',
    };
    const text = analyzingMessage(persona, { mandatory: false });
    expect(text).not.toMatch(/aqui é a leonardo/i);
    expect(text).toContain('Sou Leonardo.');
    expect(text).toContain('Olá, sou o Leonardo, seu treinador da Movivo!');
  });

  it('sem PAR-Q bloqueado: diz que manda o plano, dentro da metodologia CREF', () => {
    const text = analyzingMessage(PERSONA, { mandatory: false });
    expect(text).toMatch(/CREF/);
    expect(text).toMatch(/Logo te mando o plano completo/i);
  });

  it('PAR-Q bloqueado: anuncia a revisão humana e NÃO promete prazo', () => {
    const text = analyzingMessage(PERSONA, { mandatory: true });
    expect(text).toMatch(/profissional de Educação Física registrado no CREF/i);
    expect(text).toMatch(/esse profissional vai olhar/i);
    expect(text).not.toMatch(/logo te mando|em até|2 horas|prazo/i);
  });

  it('emojiPolicy NENHUM não inclui emoji (nem nas duas variantes)', () => {
    const emojiPattern = /\p{Extended_Pictographic}/u;
    expect(analyzingMessage(NO_EMOJI, { mandatory: false })).not.toMatch(emojiPattern);
    expect(analyzingMessage(NO_EMOJI, { mandatory: true })).not.toMatch(emojiPattern);
    expect(analyzingMessage(PERSONA, { mandatory: false })).toMatch(emojiPattern);
    // Sem o emoji, a frase não pode ficar com espaço duplo nem colada.
    expect(analyzingMessage(NO_EMOJI, { mandatory: false })).not.toMatch(/ {2}/);
    expect(analyzingMessage(NO_EMOJI, { mandatory: false })).toMatch(/\. Já estou analisando/);
  });

  it('a entrega do protocolo respeita a mesma política de emoji', () => {
    expect(delivery(NO_EMOJI)).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(delivery(NO_EMOJI)).not.toMatch(/ {2}/);
  });
});

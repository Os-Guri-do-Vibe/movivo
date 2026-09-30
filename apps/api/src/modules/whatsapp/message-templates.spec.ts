import { DEFAULT_AGENT_PERSONA, type AgentPersona } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import {
  analyzingMessage,
  BUBBLE_SEPARATOR,
  confirmationCareMessage,
  confirmationMessage,
  phoneVerificationMessage,
  protocolDeliveryPdfText,
  PROTOCOL_WAITING_DELAY_MS,
} from './message-templates';

const PERSONA = DEFAULT_AGENT_PERSONA;
const NO_EMOJI: AgentPersona = { ...DEFAULT_AGENT_PERSONA, emojiPolicy: 'NENHUM' };

/** Guardrails inegociáveis (CLAUDE.md / Sofia §13): a copy nunca pode conter estes termos. */
const FORBIDDEN = /diagn[óo]stico|tratamento|\bcura\b|garantid|garantia|prescri/i;

const allTexts = [
  confirmationMessage('Ana'),
  phoneVerificationMessage('268267'),
  confirmationCareMessage(),
  analyzingMessage(PERSONA),
  analyzingMessage(NO_EMOJI),
  protocolDeliveryPdfText('Ana'),
  protocolDeliveryPdfText(null),
  protocolDeliveryPdfText('Ana', 'Seu treino trabalha corpo inteiro 3x por semana.'),
  // Achado 2026-09-09 (bug reproduzido ao vivo pelo fundador): a saudação de reentrega
  // pós-substituição tinha um travessão que escapou da checagem por não ter cobertura
  // aqui — este é exatamente o caminho onde ele apareceu, por isso entra na varredura.
  protocolDeliveryPdfText('Rodrigo', undefined, [
    { from: 'Supino Reto (Barra)', to: 'Supino Reto (Máquina)' },
  ]),
  // Achado 2026-09-30 (troca em lote): a mesma saudação com mais de uma troca.
  protocolDeliveryPdfText('Rodrigo', undefined, [
    { from: 'Leg Press 45°', to: 'Agachamento Hack' },
    { from: 'Cadeira Extensora', to: 'Afundo' },
    { from: 'Mesa Flexora', to: 'Stiff' },
  ]),
];

describe('saudação de reentrega pós-substituição (troca em lote)', () => {
  it('uma troca: singular, nomeando o de/para', () => {
    const text = protocolDeliveryPdfText('Rodrigo', undefined, [
      { from: 'Supino Reto (Barra)', to: 'Supino Reto (Máquina)' },
    ]);
    expect(text).toContain('a troca do seu exercício já foi feita');
    expect(text).toContain('"Supino Reto (Barra)" virou "Supino Reto (Máquina)"');
  });

  it('várias trocas: plural, nomeando todas em português natural', () => {
    const text = protocolDeliveryPdfText('Rodrigo', undefined, [
      { from: 'Leg Press 45°', to: 'Agachamento Hack' },
      { from: 'Cadeira Extensora', to: 'Afundo' },
      { from: 'Mesa Flexora', to: 'Stiff' },
    ]);
    expect(text).toContain('a troca dos seus exercícios já foi feita');
    expect(text).toContain(
      '"Leg Press 45°" virou "Agachamento Hack", "Cadeira Extensora" virou "Afundo" e "Mesa Flexora" virou "Stiff"',
    );
  });

  it('sem trocas (lista vazia) mantém a saudação de 1ª entrega', () => {
    expect(protocolDeliveryPdfText('Rodrigo', undefined, [])).toContain('seu treino está pronto');
  });
});

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

  it('variante de cuidado cita o CREF', () => {
    expect(confirmationCareMessage()).toMatch(/CREF/);
  });

  it('variante de cuidado não promete plano automático', () => {
    expect(confirmationCareMessage()).toMatch(/revisar/i);
    expect(confirmationCareMessage()).not.toMatch(/2 horas|em até 2h/i);
  });

  it('código de verificação sai em negrito do WhatsApp (*código*)', () => {
    expect(phoneVerificationMessage('268267')).toBe(
      'Seu código de confirmação da MOVIVO é *268267*.\n\n' +
        'Ele confirma que este WhatsApp é seu e é válido por 10 minutos.\n\n' +
        'Não compartilhe este código com ninguém.',
    );
  });

  it('confirma sincronamente sem prometer prazo operacional', () => {
    expect(confirmationMessage('Ana')).toMatch(/Recebemos suas informações/i);
    expect(confirmationMessage('Ana')).not.toMatch(/2 horas|em até 2h|prazo/i);
  });

  it('confirmação saúda pelo primeiro nome quando disponível, e genericamente quando não', () => {
    expect(confirmationMessage('Ana')).toMatch(/^Olá, Ana! 💚/);
    expect(confirmationMessage(null)).toMatch(/^Olá! 💚/);
  });

  it('entrega COM PDF: saúda pelo primeiro nome (achado 2026-09-04)', () => {
    expect(protocolDeliveryPdfText('Ana')).toBe(
      'Ana, seu treino está pronto. 💚\n\n' +
        'Montamos seu protocolo considerando seus objetivos, sua rotina, sua disponibilidade e ' +
        'tudo o que você compartilhou com a gente.\n\n' +
        'A partir de agora, esse é o seu ponto de partida.\n\n' +
        'Acesse seu treino, conheça cada etapa e, sempre que precisar, fale com a gente por ' +
        'aqui.\n\n' +
        'Agora é colocar o corpo em movimento e construir progresso, um treino de cada vez.',
    );
    expect(protocolDeliveryPdfText(null)).toMatch(/^Seu treino está pronto\. 💚/);
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
});

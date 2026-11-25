import { describe, expect, it } from 'vitest';

import {
  PROTOCOLS_READY_DOCUMENTS,
  protocolsReadyBubbles,
} from '../planning/plan-delivery.service';
import {
  confirmationCareMessage,
  confirmationMessage,
  phoneVerificationMessage,
  staffQueueAlertMessage,
} from './message-templates';

/** Guardrails inegociáveis: a copy nunca pode conter estes termos. */
const FORBIDDEN = /diagn[óo]stico|tratamento|\bcura\b|garantid|garantia|prescri/i;

const allTexts = [
  confirmationMessage('Ana'),
  phoneVerificationMessage('268267'),
  confirmationCareMessage(),
  confirmationCareMessage('Ana'),
  confirmationMessage(null),
  staffQueueAlertMessage('sinal de segurança', 'urgente'),
];

describe('templates de WhatsApp', () => {
  it('nenhuma copy contém termo proibido', () => {
    for (const text of allTexts) expect(text).not.toMatch(FORBIDDEN);
  });

  /**
   * Regra de produto: o atendimento do WhatsApp nunca usa travessão "—", nem nas mensagens
   * fixas. A saída livre do modelo passa por outra varredura; esta cobre a copy FIXA.
   */
  it('nenhuma copy fixa usa travessão (—)', () => {
    for (const text of allTexts) expect(text).not.toContain('—');
  });

  it('nenhuma mensagem do fluxo leva link', () => {
    for (const text of allTexts) expect(text).not.toMatch(/https?:\/\/|www\.|\.com\b/i);
  });

  it('variante de cuidado informa a revisão profissional', () => {
    // Uma bolha só: os três parágrafos vão separados por linha em branco.
    expect(confirmationCareMessage('Ana')).toBe(
      [
        'Ana, recebemos suas respostas. Agradecemos a confiança.',
        'Por segurança, um profissional vai revisar algumas informações antes de liberar seus protocolos. É um cuidado que a gente tem sempre que algumas respostas pedem um olhar mais próximo.',
        'Assim que estiver tudo certo, avisamos por aqui. Se surgir alguma dúvida nesse meio-tempo, é só responder esta conversa.',
      ].join('\n\n'),
    );
    expect(confirmationCareMessage('Ana')).not.toContain('\n---\n');
  });

  it('variante de cuidado não promete plano automático', () => {
    expect(confirmationCareMessage()).toMatch(/revisar/i);
    expect(confirmationCareMessage()).not.toMatch(/2 horas|em até 2h/i);
  });

  it('código de verificação sai em negrito do WhatsApp (*código*)', () => {
    expect(phoneVerificationMessage('268267')).toBe(
      'Seu código de verificação da MOVIVO é *268267*.\n' +
        'Ele vale por 10 minutos e confirma que este WhatsApp é seu.\n' +
        'Não compartilhe com ninguém, nem com quem disser ser da MOVIVO.\n' +
        'Se não foi você que pediu, é só ignorar esta mensagem.',
    );
    // Uma bolha só: o código não pode ser quebrado em várias mensagens.
    expect(phoneVerificationMessage('268267')).not.toContain('\n---\n');
  });

  it('confirma sincronamente sem prometer prazo operacional', () => {
    expect(confirmationMessage('Ana')).toBe(
      [
        'Olá, Ana! Suas respostas foram recebidas com sucesso. 💚',
        'Agora, vamos preparar seu protocolo de treino e seu plano alimentar, ambos individualizados e personalizados de acordo com seus objetivos, necessidades e preferências.',
        'Em breve, você receberá tudo por aqui.',
      ].join('\n\n'),
    );
    // Uma bolha só.
    expect(confirmationMessage('Ana')).not.toContain('\n---\n');
    expect(confirmationMessage('Ana')).not.toMatch(/2 horas|em até 2h|prazo/i);
  });

  it('confirmação saúda pelo primeiro nome quando disponível, e genericamente quando não', () => {
    expect(confirmationMessage('Ana')).toMatch(
      /^Olá, Ana! Suas respostas foram recebidas com sucesso\. 💚/,
    );
    expect(confirmationMessage(null)).toMatch(
      /^Olá! Suas respostas foram recebidas com sucesso\. 💚/,
    );
    expect(confirmationCareMessage('Ana')).toMatch(/^Ana, recebemos suas respostas/);
    expect(confirmationCareMessage()).toMatch(/^Recebemos suas respostas/);
  });

  it('alerta à equipe leva só tipo e prioridade, sem nome nem dado de saúde', () => {
    expect(staffQueueAlertMessage('sinal de segurança', 'urgente')).toBe(
      'Novo caso na fila MOVIVO\nTipo: sinal de segurança\nPrioridade: urgente',
    );
  });

  it('entrega dos protocolos: uma bolha de texto, depois um PDF por protocolo com a legenda', () => {
    expect(protocolsReadyBubbles('Ana')).toEqual([
      'Ana, seu protocolo de treino e dieta estão prontos.\n\nSe algo não combinar com a sua rotina ou preferências pessoais, é só nos avisar que a gente faz os ajustes para você.',
    ]);
    expect(protocolsReadyBubbles(null)[0]).toMatch(
      /^Seu protocolo de treino e dieta estão prontos\./,
    );
    expect(PROTOCOLS_READY_DOCUMENTS).toEqual([
      { plan: 'treino', caption: '*Protocolo de treino*: sua semana e cada sessão em detalhe.' },
      {
        plan: 'alimentacao',
        caption: '*Protocolo alimentar*: metas do dia, refeições e orientações.',
      },
    ]);
  });
});

import { describe, expect, it } from 'vitest';

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

  it('variante de cuidado cita o CREF', () => {
    expect(confirmationCareMessage()).toMatch(/CREF/);
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
    expect(confirmationMessage('Ana')).toMatch(/Recebemos suas respostas/i);
    // v2: são dois protocolos, treino e alimentar.
    expect(confirmationMessage('Ana')).toMatch(/\*treino\*/);
    expect(confirmationMessage('Ana')).toMatch(/\*alimentar\*/);
    expect(confirmationMessage('Ana')).not.toMatch(/2 horas|em até 2h|prazo/i);
  });

  it('confirmação saúda pelo primeiro nome quando disponível, e genericamente quando não', () => {
    expect(confirmationMessage('Ana')).toMatch(/^Oi, Ana! Recebemos suas respostas 💚/);
    expect(confirmationMessage(null)).toMatch(/^Oi! Recebemos suas respostas 💚/);
    expect(confirmationCareMessage('Ana')).toMatch(/^Ana, recebemos suas respostas/);
    expect(confirmationCareMessage()).toMatch(/^Recebemos suas respostas/);
  });

  it('alerta à equipe leva só tipo e prioridade, sem nome nem dado de saúde', () => {
    expect(staffQueueAlertMessage('sinal de segurança', 'urgente')).toBe(
      'Novo caso na fila MOVIVO\nTipo: sinal de segurança\nPrioridade: urgente',
    );
  });
});

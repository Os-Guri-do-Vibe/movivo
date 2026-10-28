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

  it('alerta à equipe leva só tipo e prioridade, sem nome nem dado de saúde', () => {
    expect(staffQueueAlertMessage('sinal de segurança', 'urgente')).toBe(
      'Novo caso na fila MOVIVO\nTipo: sinal de segurança\nPrioridade: urgente',
    );
  });
});

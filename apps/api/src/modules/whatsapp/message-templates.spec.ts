import type { ProtocolStructure } from '@movivo/shared';
import { describe, expect, it } from 'vitest';

import {
  BUBBLE_SEPARATOR,
  confirmationCareMessage,
  confirmationMessage,
  formatProtocolDelivery,
  waitingMessage,
} from './message-templates';

const content: ProtocolStructure = {
  promptVersion: 'v1',
  goal: 'GAIN_MUSCLE',
  phase: 'ADAPTACAO',
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

/** Guardrails inegociáveis (CLAUDE.md / Sofia §13): a copy nunca pode conter estes termos. */
const FORBIDDEN = /diagn[óo]stico|tratamento|\bcura\b|garantid|garantia|prescri/i;

const allTexts = [
  confirmationMessage(),
  confirmationCareMessage(),
  waitingMessage(),
  formatProtocolDelivery(content, 'https://x/protocolo/abc'),
];

describe('templates de WhatsApp (US-2.5)', () => {
  it('nenhuma copy contém termo proibido e todas citam o CREF onde exigido', () => {
    for (const text of allTexts) expect(text).not.toMatch(FORBIDDEN);
    expect(confirmationMessage()).toMatch(/CREF/);
    expect(confirmationCareMessage()).toMatch(/CREF/);
  });

  it('variante de cuidado não promete plano automático', () => {
    expect(confirmationCareMessage()).toMatch(/revisar/i);
    expect(confirmationCareMessage()).not.toMatch(/2 horas|em até 2h/i);
  });

  it('confirma sincronamente sem prometer prazo operacional', () => {
    expect(confirmationMessage()).toMatch(/Recebemos seus dados/i);
    expect(confirmationMessage()).not.toMatch(/2 horas|em até 2h|prazo/i);
  });

  it('entrega quebra em bolhas, destaca o 1º treino e inclui o link', () => {
    const msg = formatProtocolDelivery(content, 'https://x/protocolo/abc');
    const bubbles = msg.split(BUBBLE_SEPARATOR);
    expect(bubbles.length).toBe(3);
    expect(bubbles[0]).toMatch(/intelig[êe]ncia artificial/i); // transparência de IA
    expect(bubbles[1]).toContain('Corpo inteiro');
    expect(bubbles[1]).toContain('Agachamento goblet — 3x8-12 (descanso 90s)');
    expect(bubbles[2]).toContain('https://x/protocolo/abc');
  });
});

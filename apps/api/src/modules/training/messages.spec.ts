import { describe, expect, it } from 'vitest';

import { WHATSAPP_BUBBLE_SEPARATOR } from '../jobs/whatsapp-outbound.contract';
import { languageViolations } from '../planning/tasks/common';
import { dailyLinkMessage, greetingFor, listTitles } from './messages';

describe('mensagem do link diário', () => {
  it('escolhe a saudação pelo horário local', () => {
    expect(greetingFor('04:00')).toBe('Bom dia');
    expect(greetingFor('12:30')).toBe('Boa tarde');
    expect(greetingFor('19:00')).toBe('Boa noite');
  });

  it('lista os títulos em português', () => {
    expect(listTitles(['Força A'])).toBe('Força A');
    expect(listTitles(['Força A', 'Corrida leve'])).toBe('Força A e Corrida leve');
    expect(listTitles(['A', 'B', 'C'])).toBe('A, B e C');
  });

  it('traz o link em balões separados e respeita os guardrails de linguagem', () => {
    const text = dailyLinkMessage('Ana', ['Força A'], 'https://movivo.test/hoje/abc', 'Bom dia');
    expect(text.split(WHATSAPP_BUBBLE_SEPARATOR)).toHaveLength(3);
    expect(text).toContain('https://movivo.test/hoje/abc');
    expect(languageViolations(text, 'text')).toEqual([]);
    expect(text).not.toMatch(/falhou|preguiça|perdeu/i);
  });
});

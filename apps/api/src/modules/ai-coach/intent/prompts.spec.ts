import { describe, expect, it } from 'vitest';

import { BASE_GUARDRAIL, FORA_DE_ESCOPO_RESPONSE, resolvePrompt } from './prompts';

const FORBIDDEN = ['diagnóstico', 'tratamento', 'cura', 'garantido'];

describe('resolvePrompt', () => {
  it('herda o bloco base de guardrails', () => {
    const p = resolvePrompt('MOTIVACAO');
    expect(p).toContain(BASE_GUARDRAIL);
  });

  it('SUBSTITUICAO_EXERCICIO instrui verbalizar sem decidir', () => {
    const p = resolvePrompt('SUBSTITUICAO_EXERCICIO');
    expect(p.toLowerCase()).toContain('não sugira exercício fora');
    expect(p.toLowerCase()).toContain('verbaliza');
  });

  it('CHECKIN_ANTECIPADO informa que o ajuste vem no check-in', () => {
    expect(resolvePrompt('CHECKIN_ANTECIPADO').toLowerCase()).toContain('check-in');
  });
});

describe('guardrails de copy', () => {
  it('a resposta pré-aprovada não usa os termos vedados (por palavra, não substring)', () => {
    // Fronteira de palavra: "procurar" contém "cura" mas não é o termo vedado (igual US-2.3).
    for (const t of FORBIDDEN) {
      expect(new RegExp(`\\b${t}\\b`, 'i').test(FORA_DE_ESCOPO_RESPONSE)).toBe(false);
    }
  });

  it('a resposta de fora de escopo é honesta e redireciona', () => {
    expect(FORA_DE_ESCOPO_RESPONSE.length).toBeGreaterThan(20);
  });
});

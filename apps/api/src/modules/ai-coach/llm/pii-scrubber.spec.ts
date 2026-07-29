/**
 * Unit — PII Scrubber (US-2.2 / TASK-2.2.1). Prova que nenhum identificador direto
 * escapa e que a lesão é normalizada em rótulo estável.
 */
import { describe, expect, it } from 'vitest';

import { scrubPII } from './pii-scrubber';

const USER = {
  name: 'João Silva',
  phoneNumber: '+5511999998888',
  email: 'joao.silva@example.com',
  birthDate: '1995-04-12',
};

describe('scrubPII', () => {
  it('remove nome, telefone, e-mail, nascimento do próprio usuário', () => {
    const out = scrubPII(
      'Sou o João Silva, meu telefone é +5511999998888 e e-mail joao.silva@example.com, nasci em 1995-04-12.',
      USER,
    );
    expect(out).not.toContain('João');
    expect(out).not.toContain('Silva');
    expect(out).not.toContain('+5511999998888');
    expect(out).not.toContain('joao.silva@example.com');
    expect(out).not.toContain('1995-04-12');
    expect(out).toContain('o usuário');
  });

  it('remove CPF, e-mail e telefone genéricos (campo livre)', () => {
    const out = scrubPII('Contato 123.456.789-00, maria@teste.com, (21) 98877-6655.', {});
    expect(out).not.toMatch(/\d{3}\.\d{3}\.\d{3}-\d{2}/);
    expect(out).not.toContain('maria@teste.com');
    expect(out).not.toContain('98877-6655');
    expect(out).toContain('[cpf]');
    expect(out).toContain('[email]');
    expect(out).toContain('[telefone]');
  });

  it('normaliza lesão em rótulo estável e derruba nome de terceiro (caso registrado)', () => {
    const out = scrubPII('Tenho lesão no ombro direito do João.', {});
    expect(out).toContain('lesão: ombro D');
    expect(out).not.toContain('João');
  });

  it('preserva texto sem PII', () => {
    const out = scrubPII('Quero ganhar massa treinando 4x por semana em casa.', USER);
    expect(out).toBe('Quero ganhar massa treinando 4x por semana em casa.');
  });

  it('substitui nome de terceiro precedido por de/do/da (heurística)', () => {
    const out = scrubPII('Segui o conselho do Carlos Souza.', {});
    expect(out).not.toContain('Carlos');
    expect(out).toContain('terceiro');
  });
});

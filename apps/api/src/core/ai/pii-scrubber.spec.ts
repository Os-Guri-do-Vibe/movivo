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

  it('normaliza lesão em rótulo estável, derrubando o resto da frase junto (inclui nome citado nela)', () => {
    const out = scrubPII('Tenho lesão no ombro direito do João.', {});
    expect(out).toContain('lesão: ombro D');
    expect(out).not.toContain('João');
  });

  it('preserva texto sem PII', () => {
    const out = scrubPII('Quero ganhar massa treinando 4x por semana em casa.', USER);
    expect(out).toBe('Quero ganhar massa treinando 4x por semana em casa.');
  });

  // Achado 2026-09-08 (decisão do fundador): a heurística de "menção a terceiro" (de/do/da +
  // Nome Próprio) foi REMOVIDA — o painel de profissionais é de uso interno da MOVIVO, não
  // precisa desse nível de anonimização, e a heurística disparava em qualquer nome de
  // exercício composto ("Caminhada de Mala" → "Caminhada de terceiro"), corrompendo tanto o
  // texto enviado ao LLM quanto a conversa exibida ao profissional.
  it('NÃO mexe mais em menção a terceiro, mesmo composta com "de/do/da" (heurística removida)', () => {
    const out = scrubPII('Segui o conselho do Carlos Souza sobre a Caminhada de Mala.', {});
    expect(out).toBe('Segui o conselho do Carlos Souza sobre a Caminhada de Mala.');
  });

  // Achado 2026-09-10 (bug reportado pelo fundador, reproduzido ao vivo): nome com partícula
  // ("Rodrigo Cavalcante DE Barros") fazia TODO "de" do texto virar "o usuário" — "a vontade
  // de ir treinar" saía como "a vontade o usuário ir treinar". Partícula sozinha não é PII (não
  // identifica ninguém), então não deve ser substituída como token isolado.
  it('não substitui a partícula do nome ("de"/"da"/"do"/"dos"/"das"/"e") como token isolado', () => {
    const user = {
      name: 'Rodrigo Cavalcante de Barros',
      phoneNumber: null,
      email: null,
      birthDate: null,
    };
    const out = scrubPII(
      'Sono é onde o corpo se recupera do treino, e isso derruba a vontade de ir treinar.',
      user,
    );
    expect(out).toBe(
      'Sono é onde o corpo se recupera do treino, e isso derruba a vontade de ir treinar.',
    );
  });

  it('ainda remove o nome de verdade quando o titular tem partícula no sobrenome', () => {
    const user = {
      name: 'Rodrigo Cavalcante de Barros',
      phoneNumber: null,
      email: null,
      birthDate: null,
    };
    const out = scrubPII('Aqui fala o Rodrigo Cavalcante de Barros.', user);
    expect(out).not.toContain('Rodrigo');
    expect(out).not.toContain('Cavalcante');
    expect(out).not.toContain('Barros');
    expect(out).toContain('o usuário');
  });
});

/**
 * TASK-0.3.5 — "nunca logar PII em claro" precisa ser um teste, não um comentário.
 */
import { describe, expect, it } from 'vitest';

import { maskPhone, REDACT_PATHS, REDACTED, redactObject, redactPii } from './redaction.util';

describe('maskPhone', () => {
  it('preserva DDI+DDD e os dois últimos dígitos', () => {
    expect(maskPhone('+5511987654321')).toBe('+5511*******21');
  });

  it('funciona com separadores', () => {
    expect(maskPhone('(11) 98765-4321')).toBe('1198*****21');
  });

  it('redige por completo o que é curto demais para mascarar com segurança', () => {
    expect(maskPhone('1234')).toBe(REDACTED);
  });
});

describe('redactPii', () => {
  it('redige e-mail', () => {
    expect(redactPii('falha ao enviar para joao.silva@exemplo.com.br')).not.toContain('joao.silva');
  });

  it('redige CPF com e sem máscara', () => {
    expect(redactPii('cpf 123.456.789-09')).toContain(REDACTED);
    expect(redactPii('cpf 12345678909')).toContain(REDACTED);
  });

  it('mascara telefone embutido em texto livre de erro de terceiro', () => {
    const output = redactPii('AraraHQ recusou o envio para +55 11 98765-4321 (rate limit)');
    expect(output).not.toContain('98765');
    expect(output).toContain('rate limit');
  });
});

describe('redactObject', () => {
  it('substitui campos sensíveis por chave, independentemente do valor', () => {
    const result = redactObject({
      userId: '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
      phone: '+5511987654321',
      anamnesis: { injuries: ['joelho'] },
      status: 'active',
    }) as Record<string, unknown>;

    expect(result.userId).toBe('3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'); // UUID pode logar
    expect(result.phone).toBe(REDACTED);
    expect(result.anamnesis).toBe(REDACTED);
    expect(result.status).toBe('active');
  });

  it('desce em objetos aninhados e arrays', () => {
    const result = redactObject({ list: [{ email: 'a@b.com' }] }) as { list: { email: string }[] };
    expect(result.list[0]?.email).toBe(REDACTED);
  });

  it('não entra em recursão infinita com profundidade excessiva', () => {
    let deep: unknown = 'fim';
    for (let i = 0; i < 20; i += 1) deep = { nested: deep };
    expect(() => redactObject(deep)).not.toThrow();
  });
});

describe('REDACT_PATHS (redação estrutural do pino)', () => {
  it('cobre os identificadores primários do produto e o header de autorização', () => {
    for (const path of ['phone', 'email', 'req.headers.authorization', '*.password']) {
      expect(REDACT_PATHS).toContain(path);
    }
  });

  it('não contém caminhos duplicados', () => {
    expect(new Set(REDACT_PATHS).size).toBe(REDACT_PATHS.length);
  });
});

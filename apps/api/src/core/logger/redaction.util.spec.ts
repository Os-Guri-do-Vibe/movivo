/**
 * TASK-0.3.5 — "nunca logar PII em claro" precisa ser um teste, não um comentário.
 */
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
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
  it('redige tokens bearer e códigos de links públicos em todos os paths compartilhados', () => {
    const paths = [
      'protocolo',
      'protocol/by-token',
      'protocols/by-token',
      'assinar',
      'conta',
      'checkout',
      'check-in',
      'semana',
      'cancelar',
      'short-links',
      'checkin/session',
      'protocol-renewal/session',
      'subscription/checkout',
      'subscription',
      'anamnesis/session',
    ];
    for (const path of paths) {
      expect(redactPii(`/api/v1/${path}/secret-token/pdf`)).toBe(`/api/v1/${path}/${REDACTED}/pdf`);
    }
  });
  it('redige e-mail', () => {
    expect(redactPii('falha ao enviar para joao.silva@exemplo.com.br')).not.toContain('joao.silva');
  });

  it('redige CPF com e sem máscara', () => {
    expect(redactPii('cpf 123.456.789-09')).toContain(REDACTED);
    expect(redactPii('cpf 12345678909')).toContain(REDACTED);
  });

  it('mascara telefone embutido em texto livre de erro de terceiro', () => {
    const output = redactPii('EvolutionAPI recusou o envio para +55 11 98765-4321 (rate limit)');
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

describe('redactObject — payloads grandes (regressão: envio de fotos derrubava a API)', () => {
  it('troca Buffer e arrays tipados pelo tamanho, sem iterar os bytes', () => {
    const photo = Buffer.alloc(8 * 1024 * 1024, 7);
    const started = Date.now();
    const result = redactObject({ req: { body: photo }, other: new Uint8Array(10) }) as {
      req: { body: unknown };
      other: unknown;
    };
    expect(Date.now() - started).toBeLessThan(200);
    expect(result.req.body).toBe(`[binário ${photo.byteLength} bytes]`);
    expect(result.other).toBe('[binário 10 bytes]');
  });

  it('reduz a requisição/resposta HTTP crua ao que o serializer usa, sem arrastar o corpo', () => {
    const request = new IncomingMessage(new Socket());
    Object.assign(request, {
      id: 'abc',
      method: 'PUT',
      url: '/api/v1/anamnesis/session/t/photo/FRONT',
      body: Buffer.alloc(4 * 1024 * 1024),
      rawBody: Buffer.alloc(4 * 1024 * 1024),
    });
    const response = new ServerResponse(request);
    const started = Date.now();
    const result = redactObject({ req: request, res: response, responseTime: 5 });
    expect(Date.now() - started).toBeLessThan(200);
    expect(result).toEqual({
      req: { id: 'abc', method: 'PUT', url: '/api/v1/anamnesis/session/t/photo/FRONT' },
      res: { statusCode: 200 },
      responseTime: 5,
    });
  });

  it('limita arrays e objetos enormes e avisa que houve corte', () => {
    const big = redactObject({ list: Array.from({ length: 5000 }, (_, i) => i) }) as {
      list: unknown[];
    };
    expect(big.list).toHaveLength(201);
    expect(big.list.at(-1)).toBe('[+4800 itens omitidos]');
    const wide = redactObject(
      Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`k${i}`, i])),
    ) as Record<string, unknown>;
    expect(Object.keys(wide)).toHaveLength(201);
    expect(wide['[omitidos]']).toBe(true);
  });

  it('continua redigindo PII mesmo dentro de objetos truncados', () => {
    const result = redactObject({ list: [{ phone: '+5511987654321' }] }) as {
      list: { phone: string }[];
    };
    expect(result.list[0]?.phone).toBe(REDACTED);
  });
});

describe('REDACT_PATHS (redação estrutural do pino)', () => {
  it('cobre os identificadores primários do produto e o header de autorização', () => {
    for (const path of ['phone', 'email', 'req.headers.authorization', '*.password']) {
      expect(REDACT_PATHS).toContain(path);
    }
  });

  // TASK-8.9.1 (Sato): o payload bruto do gateway trafega no `data` do job de conciliação
  // e o `DeadLetterRecord` copia `job.data` inteiro. Redigir pelo nome do campo fecha o
  // vazamento para qualquer handler de DLQ futuro que serialize o record.
  it('redige o payload bruto do gateway de pagamento, na raiz e dentro de `data`', () => {
    for (const path of ['rawPayload', 'data.rawPayload', 'raw_payload']) {
      expect(REDACT_PATHS).toContain(path);
    }
    const record = redactObject({
      queue: 'payment-reconciliation',
      data: { rawPayload: { card: '4111111111111111' } },
    });
    expect(JSON.stringify(record)).not.toContain('4111111111111111');
  });

  it('redige credenciais de provedores e configuração de runtime', () => {
    expect(REDACT_PATHS).toContain('req.headers["asaas-access-token"]');
    expect(REDACT_PATHS).toContain('req.headers.apikey');
    const input = { OPENAI_API_KEY: 'canary', JWT_PRIVATE_KEY: 'canary', GROQ_API_KEY: 'canary' };
    expect(JSON.stringify(redactObject(input))).not.toContain('canary');
  });

  it('não contém caminhos duplicados', () => {
    expect(new Set(REDACT_PATHS).size).toBe(REDACT_PATHS.length);
  });
});

it('redige mensagem e stack de Error sem perder diagnóstico', () => {
  const error = new Error('GET /assinar/secret-canary falhou');
  const output = redactObject({ err: error, msg: '/protocolo/secret-canary' });
  expect(JSON.stringify(output)).not.toContain('secret-canary');
  expect(JSON.stringify(output)).toContain('Error');
  expect(JSON.stringify(output)).toContain('falhou');
});

it('redige keyring inteiro e token Vault pelo inventário compartilhado de secrets', () => {
  const result = redactObject({
    HEALTH_CIPHER_KEYRING: '{"active":"secret-material"}',
    VAULT_TOKEN: 'secret-token',
    nested: { HEALTH_CIPHER_KEYRING: { active: 'secret-material' }, VAULT_TOKEN: 'token' },
  }) as Record<string, unknown>;
  expect(result.HEALTH_CIPHER_KEYRING).toBe(REDACTED);
  expect(result.VAULT_TOKEN).toBe(REDACTED);
  expect(JSON.stringify(result)).not.toContain('secret-material');
  expect(JSON.stringify(result)).not.toContain('secret-token');
});

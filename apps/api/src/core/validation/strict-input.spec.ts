import { describe, expect, it } from 'vitest';
import { ZodError, z } from 'zod';

import { findNullBytes, findUnknownKeys, parseBody, strictSafeParse } from './strict-input';

const profile = z.object({
  name: z.string().optional(),
  address: z.object({ city: z.string() }).optional(),
  tags: z.array(z.object({ label: z.string() })).optional(),
});

describe('findUnknownKeys', () => {
  it('não acusa nada quando o corpo só tem chaves do schema', () => {
    expect(findUnknownKeys(profile, { name: 'Ana', address: { city: 'SP' } })).toEqual([]);
  });

  it('acusa chave privilegiada de nível raiz (mass assignment clássico)', () => {
    expect(findUnknownKeys(profile, { name: 'Ana', role: 'ADMIN' })).toEqual([['role']]);
    expect(findUnknownKeys(profile, { subscriptionActive: true })).toEqual([
      ['subscriptionActive'],
    ]);
  });

  it('acusa chave extra aninhada em objeto e em array', () => {
    expect(findUnknownKeys(profile, { address: { city: 'SP', isAdmin: true } })).toEqual([
      ['address', 'isAdmin'],
    ]);
    expect(
      findUnknownKeys(profile, { tags: [{ label: 'a' }, { label: 'b', owner: 'x' }] }),
    ).toEqual([['tags', 1, 'owner']]);
  });

  it('atravessa optional, nullable, default e readonly', () => {
    const schema = z.object({
      a: z.object({ x: z.string() }).nullable().optional(),
      b: z.object({ x: z.string() }).default({ x: '1' }).readonly(),
    });
    expect(findUnknownKeys(schema, { a: { x: '1', y: 1 }, b: { x: '1', z: 1 } })).toEqual([
      ['a', 'y'],
      ['b', 'z'],
    ]);
  });

  it('não entra em .catch(): campo que declara "nunca invalida a request" é respeitado', () => {
    const schema = z.object({ attribution: z.object({ utm: z.string() }).catch({ utm: '' }) });
    expect(findUnknownKeys(schema, { attribution: { utm: 'x', extra: 1 } })).toEqual([]);
  });

  it('enxerga objeto dentro de refine/superRefine e de pipe/transform', () => {
    const refined = z.object({ a: z.string() }).refine(() => true);
    const piped = z.object({ a: z.string() }).transform((v) => v.a);
    expect(findUnknownKeys(refined, { a: 'x', b: 1 })).toEqual([['b']]);
    expect(findUnknownKeys(piped, { a: 'x', b: 1 })).toEqual([['b']]);
  });

  it('usa o lado de saída em z.preprocess (entrada opaca)', () => {
    const schema = z.preprocess((v) => v, z.object({ a: z.string() }));
    expect(findUnknownKeys(schema, { a: 'x', b: 1 })).toEqual([['b']]);
  });

  it('respeita .passthrough()/.catchall() como declaração explícita de aceitar o resto', () => {
    expect(findUnknownKeys(z.looseObject({ a: z.string() }), { a: 'x', b: 1 })).toEqual([]);
    expect(
      findUnknownKeys(z.object({ a: z.string() }).catchall(z.object({ n: z.number() })), {
        a: 'x',
        b: { n: 1, extra: 1 },
      }),
    ).toEqual([['b', 'extra']]);
  });

  it('em record, valida só os valores (as chaves são livres por definição)', () => {
    const schema = z.record(z.string(), z.object({ v: z.number() }));
    expect(findUnknownKeys(schema, { k1: { v: 1 }, k2: { v: 2, extra: 1 } })).toEqual([
      ['k2', 'extra'],
    ]);
  });

  it('em union, só conta o ramo que aceita o valor', () => {
    const schema = z.union([z.string(), z.object({ a: z.string() })]);
    expect(findUnknownKeys(schema, { a: 'x', b: 1 })).toEqual([['b']]);
    expect(findUnknownKeys(schema, 'texto')).toEqual([]);
  });

  it('em discriminatedUnion, usa o ramo certo e acusa campo de outro ramo', () => {
    const schema = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), x: z.string() }),
      z.object({ kind: z.literal('b'), y: z.string() }),
    ]);
    expect(findUnknownKeys(schema, { kind: 'a', x: '1' })).toEqual([]);
    expect(findUnknownKeys(schema, { kind: 'a', x: '1', y: '2' })).toEqual([['y']]);
  });

  it('em intersection, chave é conhecida se qualquer lado a declara', () => {
    const schema = z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() }));
    expect(findUnknownKeys(schema, { a: '1', b: '2' })).toEqual([]);
    expect(findUnknownKeys(schema, { a: '1', b: '2', c: '3' })).toEqual([['c']]);
  });

  it('em tuple, valida cada posição', () => {
    const schema = z.tuple([z.object({ a: z.string() })]);
    expect(findUnknownKeys(schema, [{ a: 'x', b: 1 }])).toEqual([[0, 'b']]);
  });

  it('acusa __proto__ vindo de JSON.parse (poluição de protótipo)', () => {
    const body: unknown = JSON.parse('{"name":"x","__proto__":{"role":"ADMIN"}}');
    expect(findUnknownKeys(profile, body)).toEqual([['__proto__']]);
  });

  it('ignora valores que não são objeto sem lançar', () => {
    expect(findUnknownKeys(profile, null)).toEqual([]);
    expect(findUnknownKeys(profile, 'texto')).toEqual([]);
    expect(findUnknownKeys(profile, [1, 2])).toEqual([]);
  });
});

describe('strictSafeParse', () => {
  it('aceita corpo dentro do contrato e devolve o dado parseado', () => {
    const result = strictSafeParse(profile, { name: 'Ana' });
    expect(result).toEqual({ success: true, data: { name: 'Ana' } });
  });

  it('rejeita (em vez de descartar) chave fora da allowlist', () => {
    const result = strictSafeParse(profile, { name: 'Ana', role: 'ADMIN' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]).toMatchObject({
      code: 'unrecognized_keys',
      keys: ['role'],
      path: [],
    });
  });

  it('agrupa chaves extras por objeto-pai e informa o caminho', () => {
    const result = strictSafeParse(profile, { address: { city: 'SP', a: 1, b: 2 }, zzz: 1 });
    expect(result.success).toBe(false);
    if (result.success) return;
    const byPath = Object.fromEntries(
      result.error.issues.map((i) => [i.path.join('.'), (i as { keys: string[] }).keys]),
    );
    expect(byPath).toEqual({ address: ['a', 'b'], '': ['zzz'] });
  });

  it('soma erros de tipo e de chave desconhecida no mesmo resultado', () => {
    const result = strictSafeParse(z.object({ n: z.number() }), { n: 'x', role: 'ADMIN' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => i.code).sort()).toEqual([
      'invalid_type',
      'unrecognized_keys',
    ]);
  });
});

describe('parseBody', () => {
  it('devolve o dado parseado quando válido', () => {
    expect(parseBody(profile, { name: 'Ana' })).toEqual({ name: 'Ana' });
  });

  it('lança ZodError (o filtro global responde 400) para chave privilegiada', () => {
    expect(() => parseBody(profile, { name: 'Ana', role: 'ADMIN' })).toThrow(ZodError);
  });

  it('lança ZodError para corpo inválido por tipo', () => {
    expect(() => parseBody(z.object({ n: z.number() }), { n: 'x' })).toThrow(ZodError);
  });
});

describe('findNullBytes / rejeição de byte nulo', () => {
  it('acha byte nulo em valor, em chave, em array e em objeto aninhado', () => {
    expect(findNullBytes({ a: 'x\u0000y' })).toEqual([['a']]);
    expect(findNullBytes({ ['k\u0000']: 'ok' })).toEqual([['k\u0000']]);
    expect(findNullBytes({ list: ['ok', 'a\u0000'], deep: { s: '\u0000' } })).toEqual([
      ['list', 1],
      ['deep', 's'],
    ]);
  });

  it('texto normal, números, null e ciclos profundos demais não acusam', () => {
    expect(findNullBytes({ a: 'ok', b: 1, c: null, d: [true] })).toEqual([]);
    let deep: Record<string, unknown> = { s: '\u0000' };
    for (let i = 0; i < 100; i += 1) deep = { n: deep };
    expect(findNullBytes(deep)).toEqual([]); // além da profundidade máxima: ignorado, não explode
  });

  it('strictSafeParse recusa o corpo (400 via ZodError) mesmo quando o schema aceitaria', () => {
    const schema = z.object({ note: z.string().max(100) });
    const result = strictSafeParse(schema, { note: 'dor\u0000no ombro' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(['note']);
      expect(result.error.issues[0]?.message).toBe('Texto contém caractere inválido.');
    }
  });

  it('strictSafeParse segue aceitando texto limpo', () => {
    const schema = z.object({ note: z.string() });
    expect(strictSafeParse(schema, { note: "'; DROP TABLE users;--" }).success).toBe(true);
  });
});

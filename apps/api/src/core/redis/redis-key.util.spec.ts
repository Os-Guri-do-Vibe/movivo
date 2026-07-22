/**
 * TASK-0.3.4 — o helper de namespacing é a única barreira de isolamento entre titulares
 * no Redis (não há RLS lá). Estes testes existem para que uma regressão nele quebre o
 * build, e não a privacidade de um usuário.
 */
import { describe, expect, it } from 'vitest';

import { RedisKeyBuilder, RedisKeyError } from './redis-key.util';

const USER_A = '3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const USER_B = 'a1b2c3d4-e5f6-4718-9a0b-1c2d3e4f5061';

describe('RedisKeyBuilder', () => {
  const keys = new RedisKeyBuilder('movivo');

  it('prefixa a chave com o namespace do titular', () => {
    expect(keys.forUser(USER_A, 'context', 'latest')).toBe(`movivo:u:${USER_A}:context:latest`);
  });

  it('normaliza o userId para minúsculas (o UUID é case-insensitive, a chave não)', () => {
    expect(keys.forUser(USER_A.toUpperCase(), 'ctx')).toBe(keys.forUser(USER_A, 'ctx'));
  });

  it('gera chaves distintas para titulares distintos com o mesmo segmento', () => {
    expect(keys.forUser(USER_A, 'context')).not.toBe(keys.forUser(USER_B, 'context'));
  });

  it('separa o escopo global do escopo de titular', () => {
    expect(keys.global('feature-flags')).toBe('movivo:g:feature-flags');
    expect(keys.global('x').startsWith('movivo:u:')).toBe(false);
  });

  it('rejeita userId que não seja UUID — telefone jamais pode virar nome de chave', () => {
    expect(() => keys.forUser('+5511987654321', 'ctx')).toThrow(RedisKeyError);
    expect(() => keys.forUser('usuario@exemplo.com', 'ctx')).toThrow(RedisKeyError);
    expect(() => keys.forUser('123', 'ctx')).toThrow(RedisKeyError);
  });

  it('rejeita segmento com ":" — impede forjar um nível de namespace', () => {
    // Sem esta checagem, um segmento controlado pelo usuário alcançaria outro titular.
    expect(() => keys.forUser(USER_A, `ctx:u:${USER_B}:context`)).toThrow(RedisKeyError);
  });

  it('rejeita segmento vazio, com espaço ou com caractere de controle', () => {
    expect(() => keys.forUser(USER_A)).toThrow(RedisKeyError);
    expect(() => keys.forUser(USER_A, '')).toThrow(RedisKeyError);
    expect(() => keys.forUser(USER_A, 'com espaco')).toThrow(RedisKeyError);
    expect(() => keys.forUser(USER_A, 'quebra\nlinha')).toThrow(RedisKeyError);
  });

  it('produz um padrão de SCAN que cobre todas as chaves do titular e só dele', () => {
    const pattern = keys.userScanPattern(USER_A);
    expect(pattern).toBe(`movivo:u:${USER_A}:*`);
    expect(keys.forUser(USER_A, 'a', 'b').startsWith(pattern.slice(0, -1))).toBe(true);
    expect(keys.forUser(USER_B, 'a').startsWith(pattern.slice(0, -1))).toBe(false);
  });

  it('rejeita prefixo raiz inválido', () => {
    expect(() => new RedisKeyBuilder('mo:vivo')).toThrow(RedisKeyError);
  });
});

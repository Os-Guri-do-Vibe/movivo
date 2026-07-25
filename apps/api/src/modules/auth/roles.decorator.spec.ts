/**
 * Unit — decorators de RBAC (US-1.4): `@Roles()` grava metadados e `@CurrentUser()`
 * extrai o usuário do request.
 */
import 'reflect-metadata';

import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { CurrentUser, Roles, ROLES_KEY } from './roles.decorator';

describe('@Roles()', () => {
  it('grava a lista de papéis exigidos na metadata do handler', () => {
    class Ctrl {
      @Roles('PROFESSIONAL', 'ADMIN')
      handler(): number {
        return 1;
      }
    }
    const meta = Reflect.getMetadata(ROLES_KEY, Ctrl.prototype.handler);
    expect(meta).toEqual(['PROFESSIONAL', 'ADMIN']);
  });
});

describe('@CurrentUser()', () => {
  it('extrai req.user do contexto de execução', () => {
    // Trick documentado do Nest para acessar a factory de um param decorator.
    class Probe {
      run(@CurrentUser() user: unknown): unknown {
        return user;
      }
    }
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'run') as Record<
      string,
      { factory: (data: unknown, ctx: unknown) => unknown }
    >;
    const factory = Object.values(args)[0]?.factory;
    if (!factory) throw new Error('factory do @CurrentUser não encontrada');

    const user = { userId: 'u1', role: 'ADMIN', jti: 'j1' };
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ user }) }) };
    expect(factory(undefined, ctx)).toEqual(user);
  });
});

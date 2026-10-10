import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { CapabilitiesGuard } from '../auth/capabilities.guard';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { ConversationsController } from './conversations.controller';

const actor = (role: AuthenticatedUser['role']): AuthenticatedUser => ({
  userId: '11111111-1111-4111-8111-111111111111',
  role,
  jti: 'jti',
});

function contextFor(user: AuthenticatedUser, handler: keyof ConversationsController) {
  return {
    getHandler: () => ConversationsController.prototype[handler],
    getClass: () => ConversationsController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('ConversationsController', () => {
  const guard = new CapabilitiesGuard(new Reflector());

  // Conteúdo de conversa é dado de saúde: STUDENTS_READ sozinho (suporte) não basta.
  it.each(['list', 'messages', 'photo'] as const)(
    '%s: nega SUPPORT (sem leitura de saúde)',
    (h) => {
      expect(() => guard.canActivate(contextFor(actor('SUPPORT'), h))).toThrow(ForbiddenException);
    },
  );

  it.each(['list', 'messages', 'photo'] as const)('%s: aceita ADMIN e PROFESSIONAL', (h) => {
    expect(guard.canActivate(contextFor(actor('ADMIN'), h))).toBe(true);
    expect(guard.canActivate(contextFor(actor('PROFESSIONAL'), h))).toBe(true);
  });

  it.each(['MARKETING', 'FINANCE'] as const)('nega %s', (role) => {
    expect(() => guard.canActivate(contextFor(actor(role), 'list'))).toThrow(ForbiddenException);
  });
});

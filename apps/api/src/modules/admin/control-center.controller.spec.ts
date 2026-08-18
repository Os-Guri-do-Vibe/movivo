import { ConflictException } from '@nestjs/common';
import { ControlCenterCapability as Capability } from '@movivo/shared';
import { describe, expect, it, vi } from 'vitest';

import { CAPABILITIES_KEY } from '../auth/capabilities.decorator';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { ControlCenterController } from './control-center.controller';
import type { ControlCenterService } from './control-center.service';

const professional: AuthenticatedUser = {
  userId: '11111111-1111-4111-8111-111111111111',
  role: 'PROFESSIONAL',
  jti: 'jti',
};

describe('ControlCenterController', () => {
  it.each([
    ['overview', [Capability.OVERVIEW_READ]],
    ['marketing', [Capability.MARKETING_READ]],
    ['students', [Capability.STUDENTS_READ]],
    ['student', [Capability.STUDENTS_READ]],
    ['system', [Capability.SYSTEM_READ]],
    ['finance', [Capability.FINANCE_READ]],
    ['integration', [Capability.SYSTEM_READ]],
    ['createWhatsappInstance', [Capability.SYSTEM_OPERATE]],
    ['compliance', [Capability.COMPLIANCE_READ, Capability.AUDIT_READ]],
    ['denyUnsafeAnonymization', [Capability.ADMIN_DESTRUCTIVE_REQUEST]],
  ] as const)('declara capability em %s', (method, expected) => {
    expect(
      Reflect.getMetadata(
        CAPABILITIES_KEY,
        ControlCenterController.prototype[method] as (...args: never[]) => unknown,
      ),
    ).toEqual(expected);
  });

  it('delega aluno com o ator autenticado para preservar o escopo RLS', async () => {
    const students = vi.fn().mockResolvedValue({ data: { students: [] } });
    const controller = new ControlCenterController({ students } as unknown as ControlCenterService);
    await controller.students(professional);
    expect(students).toHaveBeenCalledWith(professional);
  });

  /**
   * US-7.4: a ficha passou a abrir com `students.read` — o corte de dado de saúde é no
   * serviço, que decide o que embarca no payload. Nenhuma das duas rotas exige
   * `students.health.read` na porta.
   */
  it('não usa a capability de saúde como porta da lista nem da ficha (US-7.4)', () => {
    const read = (method: 'students' | 'student') =>
      Reflect.getMetadata(
        CAPABILITIES_KEY,
        ControlCenterController.prototype[method] as (...args: never[]) => unknown,
      ) as string[];
    expect(read('students')).not.toContain(Capability.STUDENTS_HEALTH_READ);
    expect(read('student')).toEqual([Capability.STUDENTS_READ]);
  });

  it('repassa o corpo de createWhatsappInstance para o serviço', async () => {
    const createWhatsappInstance = vi.fn().mockResolvedValue({ configured: true });
    const controller = new ControlCenterController({
      createWhatsappInstance,
    } as unknown as ControlCenterService);
    await controller.createWhatsappInstance({ instanceName: 'minha-empresa' });
    expect(createWhatsappInstance).toHaveBeenCalledWith({ instanceName: 'minha-empresa' });
  });

  it('mantém anonimização bloqueada até existir step-up', () => {
    const controller = new ControlCenterController({} as ControlCenterService);
    expect(() =>
      controller.denyUnsafeAnonymization('11111111-1111-4111-8111-111111111111'),
    ).toThrow(ConflictException);
  });
});

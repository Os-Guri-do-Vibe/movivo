/**
 * Unitários do `ConsentController` (US-1.2 / TASK-1.2.3).
 *
 * O controller é fino de propósito — a regra vive no serviço. O que se prova
 * aqui é a fronteira: o corpo passa pelo schema Zod compartilhado e a **origem
 * da prova (IP/User-Agent) é derivada da requisição**, nunca aceita do cliente.
 */
import { CONSENT_TEXTS } from '@movivo/shared';
import { describe, expect, it, vi } from 'vitest';

import { ConsentController } from './consent.controller';
import { type ConsentService } from './consent.service';

const VALID = [{ type: 'HEALTH_DATA', version: CONSENT_TEXTS.HEALTH_DATA.version, accepted: true }];

function makeController() {
  const record = vi.fn(() => Promise.resolve());
  const service = { recordForSessionToken: record } as unknown as ConsentService;
  return { controller: new ConsentController(service), record };
}

describe('ConsentController', () => {
  it('repassa token, consentimentos e a origem derivada da requisição', async () => {
    const { controller, record } = makeController();

    await controller.record('tok-123', { consents: VALID }, '203.0.113.9', 'Mozilla/5.0');

    expect(record).toHaveBeenCalledWith('tok-123', VALID, {
      ip: '203.0.113.9',
      userAgent: 'Mozilla/5.0',
    });
  });

  it('normaliza origem ausente para null (proxy sem IP, cliente sem UA)', async () => {
    const { controller, record } = makeController();

    await controller.record('tok-123', { consents: VALID }, '', undefined);

    expect(record).toHaveBeenCalledWith('tok-123', VALID, { ip: null, userAgent: null });
  });

  it('rejeita corpo fora do contrato (Zod compartilhado)', async () => {
    const { controller, record } = makeController();

    await expect(
      controller.record('tok-123', { consents: [{ type: 'INVALIDO' }] }, '1.2.3.4', 'ua'),
    ).rejects.toThrow();
    expect(record).not.toHaveBeenCalled();
  });
});

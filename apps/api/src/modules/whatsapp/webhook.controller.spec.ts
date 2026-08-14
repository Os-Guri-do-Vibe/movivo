import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from './webhook-signature';
import { WebhookController } from './webhook.controller';
import type { WhatsappInboundService } from './whatsapp-inbound.service';

function makeController(headers: Record<string, unknown>, rawBody?: Buffer) {
  const ingest = vi.fn(async () => undefined);
  const controller = new WebhookController({ ingest } as unknown as WhatsappInboundService);
  const req = { headers, rawBody } as unknown as RawBodyRequest<Request>;
  return { controller, ingest, req };
}

describe('WebhookController', () => {
  it('repassa o corpo BRUTO e os cabeçalhos de assinatura ao serviço', async () => {
    const rawBody = Buffer.from('{"event":"message"}');
    const { controller, ingest, req } = makeController(
      {
        [SIGNATURE_HEADER]: 'sha256=abc',
        [TIMESTAMP_HEADER]: '1760000000',
        'x-correlation-id': 'corr-1',
      },
      rawBody,
    );

    await expect(controller.whatsapp(req, { event: 'message' })).resolves.toEqual({ ok: true });
    expect(ingest).toHaveBeenCalledWith({
      rawBody,
      signature: 'sha256=abc',
      timestamp: '1760000000',
      body: { event: 'message' },
      correlationId: 'corr-1',
    });
  });

  it('normaliza cabeçalho repetido pegando o primeiro valor', async () => {
    const { controller, ingest, req } = makeController({
      [SIGNATURE_HEADER]: ['sha256=primeiro', 'sha256=segundo'],
      [TIMESTAMP_HEADER]: ['1760000000'],
      'x-request-id': 'req-9',
    });

    await controller.whatsapp(req, {});
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        signature: 'sha256=primeiro',
        timestamp: '1760000000',
        correlationId: 'req-9',
      }),
    );
  });

  it('responde 200 mesmo sem assinatura, corpo bruto ou correlação — o descarte é do serviço', async () => {
    const { controller, ingest, req } = makeController({});

    await expect(controller.whatsapp(req, undefined)).resolves.toEqual({ ok: true });
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        rawBody: undefined,
        signature: undefined,
        timestamp: undefined,
        correlationId: '',
      }),
    );
  });
});

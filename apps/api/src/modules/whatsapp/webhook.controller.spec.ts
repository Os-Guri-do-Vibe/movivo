import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { EVOLUTION_WEBHOOK_TOKEN_HEADER } from './inbound/evolution-inbound.edge';
import { WebhookController } from './webhook.controller';
import type { WhatsappInboundService } from './whatsapp-inbound.service';

function makeController(headers: Record<string, unknown>, rawBody?: Buffer) {
  const ingest = vi.fn(async () => undefined);
  const controller = new WebhookController({ ingest } as unknown as WhatsappInboundService);
  const req = { headers, rawBody } as unknown as RawBodyRequest<Request>;
  return { controller, ingest, req };
}

describe('WebhookController — EvolutionAPI', () => {
  const body = { event: 'messages.upsert', instance: 'movivo-teste', data: {} };

  it('encaminha token, corpo e correlação para a borda autenticada', async () => {
    const { controller, ingest, req } = makeController({
      [EVOLUTION_WEBHOOK_TOKEN_HEADER]: ['token-secreto', 'outro'],
      'x-correlation-id': 'corr-evo',
    });

    await expect(controller.whatsappEvolution(req, body)).resolves.toEqual({ ok: true });
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'EVOLUTION',
        body,
        correlationId: 'corr-evo',
        headers: expect.objectContaining({ [EVOLUTION_WEBHOOK_TOKEN_HEADER]: 'token-secreto' }),
      }),
    );
  });

  it('sem token ainda responde 200 e deixa a borda descartar', async () => {
    const { controller, ingest, req } = makeController({});
    await expect(controller.whatsappEvolution(req, body)).resolves.toEqual({ ok: true });
    expect(ingest).toHaveBeenCalledOnce();
    expect(
      (ingest as unknown as { mock: { calls: Array<[{ correlationId: string }]> } }).mock
        .calls[0]?.[0].correlationId,
    ).toBeTruthy();
  });
});

import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../../core/config';
import { EVOLUTION_WEBHOOK_TOKEN_HEADER } from './inbound/evolution-inbound.edge';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from './webhook-signature';
import { WebhookController } from './webhook.controller';
import type { WhatsappInboundService } from './whatsapp-inbound.service';

function makeController(
  headers: Record<string, unknown>,
  rawBody?: Buffer,
  transportProvider: 'ARARA' | 'EVOLUTION' = 'ARARA',
) {
  const ingest = vi.fn(async () => undefined);
  const config = {
    get whatsapp() {
      return { transportProvider };
    },
  } as unknown as AppConfigService;
  const controller = new WebhookController(
    { ingest } as unknown as WhatsappInboundService,
    config,
  );
  const req = { headers, rawBody } as unknown as RawBodyRequest<Request>;
  return { controller, ingest, req };
}

describe('WebhookController — rota AraraHQ', () => {
  it('repassa o corpo BRUTO, os headers e o provedor da ROTA ao serviço', async () => {
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
      provider: 'ARARA',
      rawBody,
      headers: {
        [SIGNATURE_HEADER]: 'sha256=abc',
        [TIMESTAMP_HEADER]: '1760000000',
        'x-correlation-id': 'corr-1',
      },
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
        headers: expect.objectContaining({ [SIGNATURE_HEADER]: 'sha256=primeiro' }),
        correlationId: 'req-9',
      }),
    );
  });

  it('responde 200 mesmo sem assinatura, corpo bruto ou correlação — o descarte é do serviço', async () => {
    const { controller, ingest, req } = makeController({});

    await expect(controller.whatsapp(req, undefined)).resolves.toEqual({ ok: true });
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({ rawBody: undefined, headers: {} }),
    );
  });

  it('sem header de correlação, SEMPRE gera um id — nunca string vazia', async () => {
    // Regressão real (QA 2026-08-24): toda entrega real da EvolutionAPI chega sem header
    // de correlação. O `''` que saía daqui virava `dedupeId` vazio e, lá na frente,
    // segmento inválido de chave Redis no marker de idempotência do envio — a resposta da
    // IA era gerada e nunca entregue. O contrato agora é: correlationId não vazio, sempre.
    const { controller, ingest, req } = makeController({});

    await controller.whatsapp(req, undefined);
    const [call] = (ingest as unknown as { mock: { calls: Array<[{ correlationId: string }]> } })
      .mock.calls;
    expect(call?.[0].correlationId).toBeTruthy();
    expect(call?.[0].correlationId.length).toBeGreaterThan(0);
  });
});

describe('WebhookController — rota EvolutionAPI', () => {
  const body = { event: 'messages.upsert', instance: 'movivo-teste', data: {} };

  it('gate DESLIGADO (transporte ARARA): 200 sem chamar o serviço', async () => {
    const { controller, ingest, req } = makeController(
      { [EVOLUTION_WEBHOOK_TOKEN_HEADER]: 'token' },
      Buffer.from('{}'),
      'ARARA',
    );

    await expect(controller.whatsappEvolution(req, body)).resolves.toEqual({ ok: true });
    expect(ingest).not.toHaveBeenCalled();
  });

  it('gate LIGADO (transporte EVOLUTION): delega com provider EVOLUTION e os headers', async () => {
    const { controller, ingest, req } = makeController(
      { [EVOLUTION_WEBHOOK_TOKEN_HEADER]: 'token-secreto', 'x-correlation-id': 'corr-evo' },
      Buffer.from('{}'),
      'EVOLUTION',
    );

    await expect(controller.whatsappEvolution(req, body)).resolves.toEqual({ ok: true });
    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'EVOLUTION',
        body,
        correlationId: 'corr-evo',
        headers: expect.objectContaining({
          [EVOLUTION_WEBHOOK_TOKEN_HEADER]: 'token-secreto',
        }),
      }),
    );
  });

  it('sem token: ainda responde 200 — quem decide descartar é a borda, não o controller', async () => {
    const { controller, ingest, req } = makeController({}, undefined, 'EVOLUTION');

    await expect(controller.whatsappEvolution(req, body)).resolves.toEqual({ ok: true });
    expect(ingest).toHaveBeenCalledOnce();
  });
});

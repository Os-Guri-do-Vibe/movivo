/**
 * `AraraInboundEdge` — borda de ENTRADA do BSP oficial (AraraHQ, US-3.1).
 *
 * Não muda nada do que já existia: `verify()` é literalmente `verifyWebhookSignature()`
 * (HMAC-SHA256 sobre o corpo bruto + janela ±5min, com todas as ressalvas de preimage
 * ainda não confirmado documentadas em `webhook-signature.ts`) e `normalize()` é o
 * `safeParse` do formato interno — a AraraHQ é o provedor para o qual o formato interno
 * foi desenhado, então normalizar é só validar.
 *
 * Este arquivo existe para que o pipeline pare de conhecer nomes de header de um provedor
 * específico, não para mudar comportamento. Qualquer teste de US-3.1 que quebre por causa
 * dele é regressão real.
 */
import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../core/config';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifyWebhookSignature } from '../webhook-signature';
import {
  type NormalizedInbound,
  normalizedInboundSchema,
  type RawDelivery,
  type VerifyResult,
} from './inbound-message';
import type { InboundProvider, WhatsappInboundEdge } from './whatsapp-inbound-edge';

@Injectable()
export class AraraInboundEdge implements WhatsappInboundEdge {
  readonly provider: InboundProvider = 'ARARA';

  constructor(private readonly config: AppConfigService) {}

  verify(delivery: RawDelivery): VerifyResult {
    return verifyWebhookSignature({
      secret: this.config.whatsapp.webhookSecret,
      rawBody: delivery.rawBody,
      signature: delivery.headers[SIGNATURE_HEADER],
      timestamp: delivery.headers[TIMESTAMP_HEADER],
    });
  }

  /**
   * O payload da AraraHQ já É o formato interno (placeholder — conta real ainda não
   * assinada, ver `webhook-signature.ts`). Sem descarte legítimo possível aqui: ou o
   * corpo casa o contrato, ou é payload inválido (`null`).
   */
  normalize(body: unknown): NormalizedInbound[] | null {
    const parsed = normalizedInboundSchema.safeParse(body);
    return parsed.success ? [parsed.data] : null;
  }
}

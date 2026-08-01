/**
 * Adaptadores REAIS Stripe/Asaas (US-4.1) — **esqueletos** confinados a este arquivo, no mesmo
 * espírito do `llm/providers.ts`/`arara-transport.ts`: o HTTP do gateway vive só aqui (teste
 * estrutural garante que nenhum outro módulo referencia os endpoints). Selecionáveis por config.
 *
 * ⚠️ MOCKS-FIRST: sem conta/SDK reais (bloqueador de LANÇAMENTO, não de dev). Os métodos ficam
 * como seam pronto — `hasCredentials()` reflete a chave e cada chamada lança `PaymentGatewayError`
 * até o formato real do provedor ser plugado. Em dev o factory usa o `MockGateway`, nunca estes.
 */
import {
  type CheckoutSession,
  type CreateCheckoutInput,
  type GatewayEvent,
  type GatewaySubscription,
  type PaymentGateway,
  PaymentGatewayError,
} from './payment-gateway.types';

/** Endpoints reais — únicos no repo, confinados aqui (marcador do teste estrutural). */
const STRIPE_API = 'https://api.stripe.com/v1';
const ASAAS_API = 'https://api.asaas.com/v3';

const NOT_WIRED =
  'gateway real ainda não implementado (mocks-first): pluga o formato do provedor no lançamento';

/** Base comum dos esqueletos: guarda a chave e o endpoint; métodos são o seam de lançamento. */
abstract class RealGatewayBase implements PaymentGateway {
  abstract readonly name: 'STRIPE' | 'ASAAS';
  protected abstract readonly baseUrl: string;

  constructor(
    protected readonly apiKey: string | undefined,
    protected readonly webhookSecret: string | undefined,
  ) {}

  hasCredentials(): boolean {
    return Boolean(this.apiKey);
  }

  // ponytail: implementar o shape real (checkout hospedado + constructEvent/HMAC) no lançamento.
  createCheckoutSession(_input: CreateCheckoutInput): Promise<CheckoutSession> {
    throw new PaymentGatewayError(
      `${this.name}.createCheckoutSession: ${NOT_WIRED} (${this.baseUrl})`,
    );
  }

  parseWebhookEvent(_rawBody: Buffer, _signature: string | undefined): GatewayEvent | null {
    throw new PaymentGatewayError(`${this.name}.parseWebhookEvent: ${NOT_WIRED}`);
  }

  cancelSubscription(_externalSubscriptionId: string): Promise<void> {
    throw new PaymentGatewayError(`${this.name}.cancelSubscription: ${NOT_WIRED}`);
  }

  getSubscription(_externalSubscriptionId: string): Promise<GatewaySubscription | null> {
    throw new PaymentGatewayError(`${this.name}.getSubscription: ${NOT_WIRED}`);
  }
}

export class StripeGateway extends RealGatewayBase {
  readonly name = 'STRIPE' as const;
  protected readonly baseUrl = STRIPE_API;
}

export class AsaasGateway extends RealGatewayBase {
  readonly name = 'ASAAS' as const;
  protected readonly baseUrl = ASAAS_API;
}

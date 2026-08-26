/**
 * `WhatsappInboundEdge` — a borda por provedor do pipeline de ENTRADA (US-3.1-EVO).
 *
 * Equivalente inbound do que `WhatsappTransport` é no outbound. Só duas
 * responsabilidades, ambas específicas do provedor:
 *   1. **autenticar** a entrega (HMAC da AraraHQ, token compartilhado da EvolutionAPI);
 *   2. **normalizar** o envelope para `NormalizedInbound`.
 *
 * Tudo depois disso (nonce, resolução do titular, gate de consentimento, roteamento,
 * debounce, fila de IA) é agnóstico de provedor e vive uma única vez em
 * `WhatsappInboundService` — nunca duplicado por provedor.
 */
import type { NormalizedInbound, RawDelivery, VerifyResult } from './inbound-message';

export type InboundProvider = 'ARARA' | 'EVOLUTION';

export interface WhatsappInboundEdge {
  readonly provider: InboundProvider;

  /** Autentica a entrega. Nunca lança — sempre retorna o veredito. */
  verify(delivery: RawDelivery): VerifyResult;

  /**
   * Normaliza o corpo já autenticado.
   *
   * `null` = payload inválido/malformado (**rejeição**: o corpo não é o que o provedor
   * diz entregar — merece log de rejeição).
   *
   * Array **vazio** = descarte LEGÍTIMO — eco `fromMe`, mensagem de grupo, tipo não
   * suportado (imagem/áudio/sticker/reaction), instância errada, backlog antigo. É uma
   * categoria diferente de "inválido": nada de errado aconteceu, só não há o que
   * processar. Distinguir as duas evita que o painel de segurança encha de "rejeição"
   * por cada figurinha que o aluno manda.
   *
   * O array cobre o caso (raro) de um envelope carregar mais de uma mensagem; hoje é
   * sempre 0 ou 1 elemento na prática.
   */
  normalize(body: unknown): NormalizedInbound[] | null;
}

/** Token de DI do mapa `{ ARARA, EVOLUTION }` de edges. */
export const WHATSAPP_INBOUND_EDGES = Symbol('MOVIVO_WHATSAPP_INBOUND_EDGES');

/** Shape resolvido pelo token acima: uma edge por provedor, sem buraco possível. */
export type WhatsappInboundEdges = Readonly<Record<InboundProvider, WhatsappInboundEdge>>;

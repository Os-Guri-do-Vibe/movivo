/**
 * Contratos da camada de IA (US-2.2 / Victor §1.1).
 *
 * O `LLMRouter` é o **único** ponto autorizado a falar com um provedor de LLM
 * (ADR-005-R2 / ARQUITETURA.md §12.12). Estes tipos são o que ele expõe; o SDK/HTTP
 * do provedor fica confinado a `providers.ts`.
 */
import type { BiologicalSex } from '@movivo/shared';

/** Classe de dado que roteia a chamada. Fail-safe: ausente ⇒ `HEALTH` (Victor §1.1). */
export type DataClass = 'HEALTH' | 'NON_HEALTH';

/** Provedores permitidos; todos passam pelo mesmo gate de classe de dado. */
export type ProviderName = 'DEEPSEEK_V4_PRO' | 'OPENAI_GPT41' | 'ANTHROPIC_SONNET45';

/** Finalidade da chamada — alimenta `ai_jobs.job_type` e o teto de tokens por propósito. */
export type LLMPurpose = 'PROTOCOL_GENERATION' | 'AI_RESPONSE' | 'CHECKIN_ADJUSTMENT';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Fontes de PII conhecidas do titular, para pseudonimização precisa (PII Scrubber).
 * Nunca guardadas fora deste boundary; usadas só para substituir o valor exato.
 */
export interface ScrubUser {
  name?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
  birthDate?: string | null;
}

export interface LLMRequest {
  purpose: LLMPurpose;
  /** UUID do titular — counter anti-abuso e escopo do `ai_jobs` sob RLS. */
  userId: string;
  /** PII do titular; o router roda o scrubber sobre `system`/`messages` antes de sair. */
  user: ScrubUser;
  dataClass?: DataClass;
  /** Prefixo estável (system CREF + metodologia + schema). Maximiza cache hit. */
  system: string;
  messages: ChatTurn[];
  /** Teto por chamada; o router faz clamp no teto global de config. */
  maxTokens?: number;
  temperature?: number;
  /** Solicita JSON nativo quando o endpoint oferece esse recurso; a saída ainda é validada. */
  json?: boolean;
  /** Marca o prefixo como cacheável (Anthropic `cache_control`; OpenAI é automático). */
  cache?: boolean;
  /** Rótulo livre para telemetria (`ai_jobs.intent`). */
  intent?: string;
  /**
   * Slot da persona que montou este prompt (Sprint 11). Serve à telemetria de cache: o
   * prefixo cacheável muda com a persona, então hit-rate agregado sem separar os dois slots
   * mistura duas populações de prompt diferentes.
   *
   * ⚠️ Combinado com `userId`, o slot revela o sexo biológico do titular — por isso o nome
   * do campo está em `PII_FIELDS` e o valor sai **redigido** do log estruturado (exigência
   * do Sato). O corte por slot, quando alguém precisar dele de fato, sai de `ai_jobs`
   * cruzado com `users.biological_sex` no banco, sob controle de acesso — não do log.
   */
  personaSlot?: BiologicalSex | null;
  /** Agrupa chamadas internas de uma mesma mensagem para o teto anti-abuso. */
  operationId?: string;
}

export interface LLMUsage {
  /** Tokens de input NÃO cacheados (preço cheio). */
  tokensInput: number;
  tokensOutput: number;
  /** Tokens de input servidos do cache (preço reduzido). */
  tokensCached: number;
}

export interface ProviderCompleteRequest {
  system: string;
  messages: ChatTurn[];
  maxTokens: number;
  temperature: number;
  cache: boolean;
  json: boolean;
}

export interface ProviderResult {
  text: string;
  model: string;
  usage: LLMUsage;
}

/**
 * Adaptador de um provedor. A implementação real (`providers.ts`) fala HTTP; os
 * testes injetam um fake sem rede para exercitar cascata/breaker/failover.
 */
export interface LLMProvider {
  readonly name: ProviderName;
  readonly model: string;
  /** Aprovação contratual/operacional explícita para a classe de dado. */
  canProcess(dataClass: DataClass): boolean;
  /** `false` quando a chave não foi provisionada (dev/CI sem segredo). */
  hasCredentials(): boolean;
  complete(req: ProviderCompleteRequest, signal: AbortSignal): Promise<ProviderResult>;
}

export type LLMErrorKind =
  | 'TRANSIENT' // erro de rede transitório → 1 retry no mesmo provedor
  | 'RATE_LIMIT' // 429 → failover direto (sem retry)
  | 'SERVER' // 5xx → failover direto
  | 'TIMEOUT' // estourou o timeout hard → failover
  | 'NO_CREDENTIALS' // chave ausente → failover; se todos, erro claro
  | 'CLIENT'; // 4xx (não-429) → não faz failover, erro do chamador

/** Erro de provedor classificado, para o router decidir retry vs. failover vs. abortar. */
export class LLMProviderError extends Error {
  constructor(
    readonly kind: LLMErrorKind,
    readonly provider: ProviderName,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'LLMProviderError';
  }
}

/** Todos os provedores falharam (indisponibilidade ou ausência total de chave). */
export class LLMUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LLMUnavailableError';
  }
}

export interface LLMResult {
  text: string;
  provider: ProviderName;
  model: string;
  tokensInput: number;
  tokensOutput: number;
  tokensCached: number;
  latencyMs: number;
  /** 1 = provedor primário serviu; 2 = fallback (revela o failover em `ai_jobs`). */
  attempt: number;
  dataClass: DataClass;
  costBrl: number;
}

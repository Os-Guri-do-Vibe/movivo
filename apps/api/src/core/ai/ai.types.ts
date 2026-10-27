/**
 * Contratos do gateway de modelos (`ModelGateway`). Os agentes pedem uma CAPACIDADE (tier),
 * nunca um modelo: qual modelo atende cada tier é configuração (`model_tiers`), trocada sem
 * deploy e só depois de passar pelos casos de avaliação.
 */
import type { ScrubUser } from './pii-scrubber';

/** Capacidade pedida pela tarefa. */
export type ModelTier = 'FAST' | 'STANDARD' | 'REASONING' | 'VISION';
export const MODEL_TIERS: readonly ModelTier[] = ['FAST', 'STANDARD', 'REASONING', 'VISION'];

/** Fornecedor (não o modelo): é a unidade da diligência de dados de saúde. */
export type ModelVendor = 'DEEPSEEK' | 'OPENAI' | 'ANTHROPIC';
export const MODEL_VENDORS: readonly ModelVendor[] = ['DEEPSEEK', 'OPENAI', 'ANTHROPIC'];

/** Classe do dado enviado. Ausente ⇒ `HEALTH` (fail-safe). */
export type DataClass = 'HEALTH' | 'NON_HEALTH';

/** Parte de uma mensagem: texto ou imagem (base64, nunca URL pública). */
export type MessagePart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string };

export interface GatewayMessage {
  role: 'user' | 'assistant';
  content: string | MessagePart[];
}

/** Uma linha de `model_tiers`: qual modelo atende o tier, em que ordem, com que parâmetros. */
export interface TierRoute {
  vendor: ModelVendor;
  model: string;
  maxOutputTokens: number;
  timeoutMs: number;
  temperature: number;
  /** Modelo aceita imagem (obrigatório para o tier VISION). */
  vision: boolean;
}

export interface GatewayRequest {
  tier: ModelTier;
  /** Tarefa que chama (ex.: `running.build_block`) — vai para `model_runs`. */
  taskId: string;
  /** Versão (hash) do prompt da tarefa. */
  promptVersion: string;
  /** Titular, quando a chamada é sobre um aluno (custo e auditoria por aluno). */
  userId: string | null;
  /** PII do titular para o scrubber das mensagens (o `system` nunca carrega PII). */
  scrubUser?: ScrubUser;
  dataClass?: DataClass;
  /** Prefixo estável e cacheável (constituição + papel + tarefa + metodologia). */
  system: string;
  messages: GatewayMessage[];
  /** Pede saída JSON nativa quando o fornecedor oferece; a validação continua no chamador. */
  json: boolean;
  /**
   * Força uma rota específica no lugar das rotas do tier — só para a avaliação comparar modelos
   * antes de trocar a configuração. Produção nunca usa.
   */
  routeOverride?: TierRoute;
}

export interface GatewayUsage {
  tokensInput: number;
  tokensCached: number;
  tokensOutput: number;
}

export interface GatewayResult {
  text: string;
  vendor: ModelVendor;
  model: string;
  usage: GatewayUsage;
  latencyMs: number;
  costBrl: number;
  /** Linha gravada em `model_runs` (para ligar à proposta/avaliação). */
  modelRunId: string;
}

/** Pedido já resolvido para um fornecedor específico. */
export interface VendorRequest {
  model: string;
  system: string;
  messages: GatewayMessage[];
  maxOutputTokens: number;
  temperature: number;
  json: boolean;
}

export interface VendorResult {
  text: string;
  usage: GatewayUsage;
}

/** Adaptador HTTP de um fornecedor. Único lugar que fala com a API externa. */
export interface ModelVendorClient {
  readonly vendor: ModelVendor;
  hasCredentials(): boolean;
  /** Diligência aprovada para dado de saúde (atestado explícito em configuração). */
  canProcess(dataClass: DataClass): boolean;
  complete(request: VendorRequest, signal: AbortSignal): Promise<VendorResult>;
}

export type VendorErrorKind =
  'TRANSIENT' | 'RATE_LIMIT' | 'SERVER' | 'TIMEOUT' | 'NO_CREDENTIALS' | 'AUTH' | 'CLIENT';

export class VendorError extends Error {
  constructor(
    readonly kind: VendorErrorKind,
    readonly vendor: ModelVendor,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`[${vendor}] ${message}`, options);
    this.name = 'VendorError';
  }
}

/** Nenhuma rota do tier conseguiu atender (todas indisponíveis, bloqueadas ou sem chave). */
export class TierUnavailableError extends Error {
  constructor(
    readonly tier: ModelTier,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'TierUnavailableError';
  }
}

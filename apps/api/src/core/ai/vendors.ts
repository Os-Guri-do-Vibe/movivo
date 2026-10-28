/**
 * Adaptadores HTTP dos fornecedores de modelo para o `ModelGateway`.
 *
 * Diferença para os adaptadores legados (`ai-coach/llm/providers.ts`): o MODELO vem em cada
 * pedido (o tier decide), e as mensagens podem trazer IMAGEM. Usa `fetch` nativo, sem SDK —
 * o confinamento é verificado por `llm-sdk-confinement.spec.ts`. Nenhum adaptador envia
 * `tools`: o modelo nunca recebe ferramenta (ver `llm-no-tool-surface.spec.ts`).
 */
import {
  type DataClass,
  type GatewayMessage,
  type ModelVendor,
  type ModelVendorClient,
  type VendorRequest,
  type VendorResult,
  VendorError,
} from './ai.types';

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/** Traduz status HTTP em erro classificado (decide retry × failover × abortar). */
export function classifyStatus(vendor: ModelVendor, status: number, body: string): VendorError {
  // Saldo esgotado também chega como 429 (`insufficient_quota`): é a conta, não o ritmo de chamadas.
  if (
    status === 429 &&
    /insufficient_quota|credit_balance|exceeded your current quota/i.test(body)
  ) {
    return new VendorError('AUTH', vendor, '429 saldo ou cota do fornecedor');
  }
  if (status === 429) return new VendorError('RATE_LIMIT', vendor, '429 rate limit');
  // Credencial inválida, conta sem saldo (402 no DeepSeek) ou sem permissão: o pedido está
  // certo, quem não atende é a conta do fornecedor — failover, não abortar.
  if (status === 401 || status === 402 || status === 403) {
    return new VendorError('AUTH', vendor, `${status} credencial ou saldo do fornecedor`);
  }
  // A Anthropic devolve conta sem saldo como 400 ("credit balance is too low"): é a conta, não
  // o pedido — failover para o próximo fornecedor.
  if (status === 400 && /credit balance|billing|quota|insufficient/i.test(body)) {
    return new VendorError('AUTH', vendor, `${status} saldo ou cota do fornecedor`);
  }
  if (status >= 500) return new VendorError('SERVER', vendor, `${status} erro do servidor`);
  return new VendorError('CLIENT', vendor, `${status}: ${body.slice(0, 200)}`);
}

function classifyNetwork(vendor: ModelVendor, cause: unknown): VendorError {
  const name = (cause as { name?: string })?.name;
  if (name === 'AbortError') return new VendorError('TIMEOUT', vendor, 'timeout', { cause });
  return new VendorError('TRANSIENT', vendor, 'erro de rede', { cause });
}

async function post(
  vendor: ModelVendor,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw classifyNetwork(vendor, cause);
  }
  if (!res.ok) throw classifyStatus(vendor, res.status, await res.text());
  return res.json();
}

/** Mensagens no formato Chat Completions (OpenAI e DeepSeek). */
function chatCompletionsMessages(system: string, messages: GatewayMessage[]) {
  return [
    { role: 'system', content: system },
    ...messages.map((message) => ({
      role: message.role,
      content:
        typeof message.content === 'string'
          ? message.content
          : message.content.map((part) =>
              part.type === 'text'
                ? { type: 'text', text: part.text }
                : {
                    type: 'image_url',
                    image_url: { url: `data:${part.mediaType};base64,${part.base64}` },
                  },
            ),
    })),
  ];
}

abstract class BaseVendor implements ModelVendorClient {
  abstract readonly vendor: ModelVendor;

  constructor(
    protected readonly apiKey: string | undefined,
    private readonly healthDataApproved: boolean,
  ) {}

  hasCredentials(): boolean {
    return Boolean(this.apiKey);
  }

  canProcess(dataClass: DataClass): boolean {
    return dataClass === 'NON_HEALTH' || this.healthDataApproved;
  }

  protected key(): string {
    if (!this.apiKey) {
      throw new VendorError('NO_CREDENTIALS', this.vendor, 'chave de API ausente');
    }
    return this.apiKey;
  }

  abstract complete(request: VendorRequest, signal: AbortSignal): Promise<VendorResult>;
}

/** OpenAI Chat Completions. Prompt caching é automático no fornecedor. */
export class OpenAiVendor extends BaseVendor {
  readonly vendor = 'OPENAI' as const;

  async complete(request: VendorRequest, signal: AbortSignal): Promise<VendorResult> {
    const data = (await post(
      this.vendor,
      OPENAI_URL,
      { authorization: `Bearer ${this.key()}` },
      {
        model: request.model,
        max_completion_tokens: request.maxOutputTokens,
        temperature: request.temperature,
        ...(request.json ? { response_format: { type: 'json_object' } } : {}),
        messages: chatCompletionsMessages(request.system, request.messages),
      },
      signal,
    )) as {
      choices?: { message?: { content?: string } }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };
    const cached = data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      usage: {
        tokensInput: Math.max(0, (data.usage?.prompt_tokens ?? 0) - cached),
        tokensCached: cached,
        tokensOutput: data.usage?.completion_tokens ?? 0,
      },
    };
  }
}

/** DeepSeek (API compatível com Chat Completions). Sem visão; cache automático. */
export class DeepSeekVendor extends BaseVendor {
  readonly vendor = 'DEEPSEEK' as const;

  async complete(request: VendorRequest, signal: AbortSignal): Promise<VendorResult> {
    const data = (await post(
      this.vendor,
      DEEPSEEK_URL,
      { authorization: `Bearer ${this.key()}` },
      {
        model: request.model,
        max_tokens: request.maxOutputTokens,
        temperature: request.temperature,
        // O modo de raciocínio do DeepSeek não converge para JSON fechado nos prompts longos
        // da MOVIVO (ver achados em `ai-coach/llm/providers.ts`): fica desligado.
        thinking: { type: 'disabled' },
        ...(request.json ? { response_format: { type: 'json_object' } } : {}),
        messages: chatCompletionsMessages(request.system, request.messages),
      },
      signal,
    )) as {
      choices?: { message?: { content?: string } }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_cache_hit_tokens?: number;
        prompt_cache_miss_tokens?: number;
      };
    };
    const cached = data.usage?.prompt_cache_hit_tokens ?? 0;
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      usage: {
        tokensInput:
          data.usage?.prompt_cache_miss_tokens ??
          Math.max(0, (data.usage?.prompt_tokens ?? 0) - cached),
        tokensCached: cached,
        tokensOutput: data.usage?.completion_tokens ?? 0,
      },
    };
  }
}

/**
 * Anthropic Messages API. `cache_control` no bloco de sistema estável. Não há modo JSON
 * nativo: o pedido de JSON vai no prompt e o chamador valida a saída.
 */
export class AnthropicVendor extends BaseVendor {
  readonly vendor = 'ANTHROPIC' as const;

  async complete(request: VendorRequest, signal: AbortSignal): Promise<VendorResult> {
    const data = (await post(
      this.vendor,
      ANTHROPIC_URL,
      { 'x-api-key': this.key(), 'anthropic-version': ANTHROPIC_VERSION },
      {
        model: request.model,
        max_tokens: request.maxOutputTokens,
        temperature: request.temperature,
        system: [{ type: 'text', text: request.system, cache_control: { type: 'ephemeral' } }],
        messages: request.messages.map((message) => ({
          role: message.role,
          content:
            typeof message.content === 'string'
              ? message.content
              : message.content.map((part) =>
                  part.type === 'text'
                    ? { type: 'text', text: part.text }
                    : {
                        type: 'image',
                        source: { type: 'base64', media_type: part.mediaType, data: part.base64 },
                      },
                ),
        })),
      },
      signal,
    )) as {
      content?: { type?: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
    };
    return {
      text: (data.content ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join(''),
      usage: {
        tokensInput: data.usage?.input_tokens ?? 0,
        tokensCached: data.usage?.cache_read_input_tokens ?? 0,
        tokensOutput: data.usage?.output_tokens ?? 0,
      },
    };
  }
}

/**
 * Adaptadores reais dos provedores de LLM (US-2.2 / TASK-2.2.2 · ADR-005-R2).
 *
 * **Este é o único arquivo do backend que fala com um provedor de LLM.** Nenhum outro
 * módulo importa SDK/HTTP de provedor — um teste estrutural (llm-sdk-confinement.spec)
 * garante isso. Usamos `fetch` nativo (Node 22) em vez de SDK: menos dependência, e o
 * confinamento fica ainda mais explícito. Todos os provedores passam pelo mesmo gate de dados.
 *
 * Chaves são **opcionais no boot** (dev/CI rodam sem chave): `hasCredentials()` retorna
 * `false` e uma chamada REAL sem chave lança `NO_CREDENTIALS` — que o router trata como
 * falha de provedor e faz failover; se todos faltarem, o erro é claro.
 */
import {
  type LLMProvider,
  LLMProviderError,
  type DataClass,
  type ProviderCompleteRequest,
  type ProviderName,
  type ProviderResult,
} from './llm.types';

/** Tokens de DI para injetar a cascata (e permitir fakes nos testes). */
export const LLM_PRIMARY_PROVIDER = Symbol('MOVIVO_LLM_PRIMARY_PROVIDER');
export const LLM_FALLBACK_PROVIDER = Symbol('MOVIVO_LLM_PROVIDER_FALLBACK');
export const LLM_SECONDARY_FALLBACK_PROVIDER = Symbol('MOVIVO_LLM_SECONDARY_FALLBACK_PROVIDER');
export const LLM_PROVIDER_CASCADE = Symbol('MOVIVO_LLM_PROVIDER_CASCADE');

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/** Traduz um erro de `fetch`/status em `LLMProviderError` classificado para o router. */
function classifyStatus(provider: ProviderName, status: number, body: string): LLMProviderError {
  if (status === 429) return new LLMProviderError('RATE_LIMIT', provider, `429 rate limit`);
  if (status >= 500) return new LLMProviderError('SERVER', provider, `${status} server error`);
  return new LLMProviderError('CLIENT', provider, `${status}: ${body.slice(0, 200)}`);
}

function classifyNetwork(provider: ProviderName, cause: unknown): LLMProviderError {
  // `AbortError` vem do timeout do router; o resto é rede transitória.
  const name = (cause as { name?: string })?.name;
  if (name === 'AbortError') return new LLMProviderError('TIMEOUT', provider, 'timeout', { cause });
  return new LLMProviderError('TRANSIENT', provider, 'erro de rede', { cause });
}

/** GPT-4.1 via Chat Completions. Prompt caching é automático (≥1024 tk), sem parâmetro. */
export class OpenAiProvider implements LLMProvider {
  constructor(
    readonly name: ProviderName,
    readonly model: string,
    private readonly apiKey: string | undefined,
    private readonly healthDataApproved = false,
  ) {}

  canProcess(dataClass: DataClass): boolean {
    return dataClass === 'NON_HEALTH' || this.healthDataApproved;
  }

  hasCredentials(): boolean {
    return Boolean(this.apiKey);
  }

  async complete(req: ProviderCompleteRequest, signal: AbortSignal): Promise<ProviderResult> {
    if (!this.apiKey) {
      throw new LLMProviderError('NO_CREDENTIALS', this.name, 'OPENAI_API_KEY ausente');
    }
    let res: Response;
    try {
      res = await fetch(OPENAI_URL, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          ...(req.json ? { response_format: { type: 'json_object' } } : {}),
          messages: [{ role: 'system', content: req.system }, ...req.messages],
        }),
      });
    } catch (cause) {
      throw classifyNetwork(this.name, cause);
    }
    if (!res.ok) throw classifyStatus(this.name, res.status, await res.text());

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };
    const cached = data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const promptTokens = data.usage?.prompt_tokens ?? 0;
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      model: this.model,
      usage: {
        tokensInput: Math.max(0, promptTokens - cached),
        tokensCached: cached,
        tokensOutput: data.usage?.completion_tokens ?? 0,
      },
    };
  }
}

/** Claude Sonnet 4.5 via Messages API. `cache_control` no bloco system estável. */
export class AnthropicProvider implements LLMProvider {
  constructor(
    readonly name: ProviderName,
    readonly model: string,
    private readonly apiKey: string | undefined,
    private readonly healthDataApproved = false,
  ) {}

  canProcess(dataClass: DataClass): boolean {
    return dataClass === 'NON_HEALTH' || this.healthDataApproved;
  }

  hasCredentials(): boolean {
    return Boolean(this.apiKey);
  }

  async complete(req: ProviderCompleteRequest, signal: AbortSignal): Promise<ProviderResult> {
    if (!this.apiKey) {
      throw new LLMProviderError('NO_CREDENTIALS', this.name, 'ANTHROPIC_API_KEY ausente');
    }
    const systemBlock = {
      type: 'text' as const,
      text: req.system,
      ...(req.cache ? { cache_control: { type: 'ephemeral' as const } } : {}),
    };
    let res: Response;
    try {
      res = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          system: [systemBlock],
          messages: req.messages,
        }),
      });
    } catch (cause) {
      throw classifyNetwork(this.name, cause);
    }
    if (!res.ok) throw classifyStatus(this.name, res.status, await res.text());

    const data = (await res.json()) as {
      content?: { type?: string; text?: string }[];
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_input_tokens?: number;
      };
    };
    const text = (data.content ?? [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('');
    return {
      text,
      model: this.model,
      usage: {
        // `input_tokens` do Anthropic já exclui os lidos do cache.
        tokensInput: data.usage?.input_tokens ?? 0,
        tokensCached: data.usage?.cache_read_input_tokens ?? 0,
        tokensOutput: data.usage?.output_tokens ?? 0,
      },
    };
  }
}

/**
 * DeepSeek V4 Pro via a API OpenAI-compatible oficial. A autorização para HEALTH não vem da
 * marca ou da chave: é um atestado explícito de due diligence, aplicado pelo LLMRouter antes
 * de qualquer byte sair. O cache é automático no provedor.
 *
 * Achado 2026-09-03 (reproduzido ao vivo, 4 tentativas reais contra geração de protocolo):
 * `thinking: enabled` nunca convergia pra uma resposta finalizada dentro de NENHUM teto
 * testado — nem com `reasoning_effort: high` nem `low` — o modelo usava 100% do
 * `max_tokens` disponível (bateu exato em 6.000/6.000, depois 16.000/16.000 duas vezes) e
 * ainda assim entregava JSON cortado no meio, sem fechar. Não era falta de espaço nem nível
 * de esforço: era o "pensamento" nunca parando sozinho em NENHUM nível testado.
 *
 * Desligado de novo (mesmo dia) depois de achar a causa real dos gaps de individualização
 * que motivaram testar o thinking: a metodologia ia como mensagem `user` no envelope de
 * dado NÃO CONFIÁVEL (ver achado em `protocol-generator.service.ts::buildSystemPrompt`),
 * então o próprio sistema instruía o modelo a nunca seguir a diretiva dela. Corrigido isso,
 * `thinking: disabled` voltou a ser a configuração segura e rápida (15-40s, nunca estourou
 * teto).
 *
 * Testado de novo em 2026-09-04 (a pedido do fundador), `reasoning_effort: medium`, depois
 * de resolver as duas pré-condições que faltavam: a causa raiz de 2026-09-03 (metodologia
 * em canal não confiável) seguia corrigida, e as faixas fixas de série/repetição/duração/
 * descanso que causavam a maioria dos `BLOCK_FALLBACK` reproduzidos ao vivo foram removidas
 * do `ValidationService` no mesmo dia (ver validation-rules.ts). MESMO ASSIM, reproduzido
 * ao vivo de novo: a chamada não retornou dentro do teto máximo permitido pelo schema
 * (`LLM_PROTOCOL_TIMEOUT_MS`, 120s — já configurado no teto desde a tentativa anterior) e
 * o router deu failover. Igual ao achado 2026-09-03: não é falta de tempo/orçamento
 * disponível (já está no máximo permitido), é o "pensamento" não convergindo a tempo neste
 * prompt. `thinking: disabled` de volta — dois testes reais em dias diferentes, com causas-
 * raiz diferentes já corrigidas no meio, e o mesmo padrão de não-convergência nos dois.
 *
 * Testado de novo em 2026-09-04 (a pedido do fundador), agora `reasoning_effort: high` —
 * `high` já tinha sido tentado em 2026-09-03, mas ANTES das duas correções acima; esta era
 * a primeira vez com as duas pré-condições já resolvidas. Reproduzido ao vivo de novo:
 * 1ª tentativa terminou em 2.395 tokens (dentro do teto) mas saiu malformada mesmo assim;
 * a 2ª tentativa (retry corretivo do próprio `ProtocolGeneratorService`) bateu EXATO nos
 * 16.000 tokens do teto e saiu cortada no meio — a geração inteira falhou
 * (`ProtocolGenerationError`, as duas tentativas esgotadas). É o MESMO padrão do achado
 * 2026-08-18/2026-09-03: o "pensamento" consome o orçamento de tokens sem fechar o JSON.
 *
 * Três testes reais (2026-09-03 high/low, 2026-09-04 medium, 2026-09-04 high), duas causas-
 * raiz diferentes corrigidas no meio do caminho, sempre o mesmo padrão de não-convergência.
 * `thinking: disabled` de volta — não é mais candidato a reteste sem uma mudança de fundo
 * (ex.: prompt substancialmente menor, ou o provedor mudar como fecha o JSON sob thinking).
 */
export class DeepSeekProvider implements LLMProvider {
  readonly name: ProviderName = 'DEEPSEEK_V4_PRO';

  constructor(
    readonly model: string,
    private readonly apiKey: string | undefined,
    private readonly healthDataApproved = false,
  ) {}

  canProcess(dataClass: DataClass): boolean {
    return dataClass === 'NON_HEALTH' || this.healthDataApproved;
  }

  hasCredentials(): boolean {
    return Boolean(this.apiKey);
  }

  async complete(req: ProviderCompleteRequest, signal: AbortSignal): Promise<ProviderResult> {
    if (!this.apiKey) {
      throw new LLMProviderError('NO_CREDENTIALS', this.name, 'DEEPSEEK_API_KEY ausente');
    }
    let res: Response;
    try {
      res = await fetch(DEEPSEEK_URL, {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: req.maxTokens,
          temperature: req.temperature,
          thinking: { type: 'disabled' },
          ...(req.json ? { response_format: { type: 'json_object' } } : {}),
          messages: [{ role: 'system', content: req.system }, ...req.messages],
        }),
      });
    } catch (cause) {
      throw classifyNetwork(this.name, cause);
    }
    if (!res.ok) throw classifyStatus(this.name, res.status, await res.text());

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        prompt_cache_hit_tokens?: number;
        prompt_cache_miss_tokens?: number;
      };
    };
    const cached = data.usage?.prompt_cache_hit_tokens ?? 0;
    const uncached =
      data.usage?.prompt_cache_miss_tokens ??
      Math.max(0, (data.usage?.prompt_tokens ?? 0) - cached);
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      model: this.model,
      usage: {
        tokensInput: uncached,
        tokensCached: cached,
        tokensOutput: data.usage?.completion_tokens ?? 0,
      },
    };
  }
}

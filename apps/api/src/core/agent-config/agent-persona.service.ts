/**
 * `AgentPersonaService` (US-7.6 / TASK-7.6.3) — resolução da persona vigente da IA, com
 * cache e fail-safe. Mora no CORE (DI global, §12.5): `whatsapp`, `subscription` e `coach`
 * precisam do nome/tom da agente sem poder importar módulo de domínio um do outro.
 *
 * ## Duas personas simultâneas, resolvidas por titular (Sprint 11)
 * Existem DOIS slots publicáveis — `MALE` e `FEMALE` — e cada titular é atendido pelo slot
 * correspondente ao `biologicalSex` que ele informou na Etapa 1 da anamnese. A resolução é
 * **sempre dinâmica**: nada é fixado por titular, toda mensagem resolve a persona vigente
 * na hora. Publicar a persona do outro slot muda o atendimento do titular no próximo turno,
 * sem migração de dado e sem ação manual.
 *
 * `targetSex` é parâmetro **obrigatório** (sem default) justamente para que todo call site
 * declare a intenção: `null` significa "não há titular em contexto", não "tanto faz".
 *
 * ## Empréstimo entre slots — enquanto só uma das duas personas existir, ela atende todo mundo
 * Ordem de resolução para o slot pedido: Redis do slot → banco do slot → Redis/banco do
 * OUTRO slot (empréstimo) → `DEFAULT_AGENT_PERSONA`. Ou seja: **havendo qualquer persona
 * publicada, ninguém cai no default de fábrica**. O empréstimo emite `agent_config_fallback`
 * com `reason: 'SLOT_BORROWED'` — em `info`, não `warn`, porque não é falha: é o estado
 * normal e esperado entre a primeira e a segunda publicação. Os `reason` de falha real
 * (`CONFIG_ABSENT`, `INVALID_PAYLOAD`, `DATABASE_UNAVAILABLE`) seguem em `warn` e não se
 * misturam com este.
 *
 * ## A regra que manda em tudo aqui: fail-safe nunca é "sem guardrail"
 * Se o Redis cair, se o banco não responder, se não houver configuração publicada em slot
 * nenhum, ou se o payload publicado não validar contra o Zod — o serviço devolve
 * `DEFAULT_AGENT_PERSONA` (`@movivo/shared`), o default **compilado**. Em nenhum caminho de
 * erro este serviço devolve persona vazia ou parcial.
 *
 * ## Cache
 * Um slot, uma entrada: `Map<BiologicalSex, …>` com TTL de 60s (o teto de propagação
 * exigido pela US). A publicação faz `SET` (do slot publicado) + `PUBLISH` no Redis; cada
 * instância da API assina o canal e limpa o cache na hora, o que na prática torna a
 * propagação imediata.
 *
 * **A invalidação limpa SEMPRE os dois slots**, mesmo que só um tenha sido publicado:
 * enquanto um slot está órfão ele empresta do outro, então publicar no slot A muda o que o
 * slot B devolve. Invalidar só o publicado deixaria o órfão servindo payload desatualizado
 * até o TTL expirar.
 *
 * O snapshot Redis de cada slot guarda **só o payload publicado daquele slot**, nunca o
 * emprestado — persistir empréstimo transformaria um estado transitório de resolução em
 * estado gravado, que sobreviveria à publicação que deveria corrigi-lo.
 *
 * Lógica específica de intenção (`resolvePrompt`, `buildForaDeEscopoResponse`) fica em
 * `ai-coach/intent/prompt-resolver.service.ts`, que consome este serviço por `.persona(targetSex)`.
 */
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
// Leitura usa o schema TOLERANTE: uma linha publicada antes de um campo novo existir não
// pode virar fallback silencioso para o default de código só por ser antiga (ver o cabeçalho
// de `agentPersonaStoredSchema`). O schema estrito continua valendo na gravação.
import {
  agentPersonaStoredSchema,
  DEFAULT_AGENT_PERSONA,
  type AgentPersona,
  type BiologicalSex,
} from '@movivo/shared';
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';

import { REDIS_CLIENT } from '../redis/redis.constants';
import { REDIS_KEY_BUILDER, RedisKeyBuilder } from '../redis/redis-key.util';
import { AgentConfigRepository } from './agent-config.repository';

/** TTL do cache em memória. Teto de propagação de uma publicação sem pub/sub. */
export const PERSONA_CACHE_TTL_MS = 60_000;

/**
 * Segmentos da chave do snapshot **daquele slot** — usados também pelo publicador
 * (`AdminModule`). Deixou de ser constante quando a persona passou a ter dois slots: uma
 * chave só compartilhada pelos dois faria a última publicação sobrescrever a outra persona.
 */
export function agentConfigKeySegments(targetSex: BiologicalSex): [string, string, string] {
  return ['agent-config', 'current', targetSex];
}

/** Canal de invalidação — único para os dois slots (a invalidação é sempre total). */
export const AGENT_CONFIG_CHANNEL_SEGMENTS = ['agent-config', 'invalidate'] as const;

/** Slot de onde o outro empresta quando está órfão. */
const OTHER_SLOT: Record<BiologicalSex, BiologicalSex> = { MALE: 'FEMALE', FEMALE: 'MALE' };

/**
 * Slot consultado primeiro quando **não há titular em contexto** (`null`) — mensagem de
 * sistema, preview, superfície sem destinatário resolvido. A escolha é arbitrária e não
 * tem efeito prático: sem titular, o empréstimo alcança o outro slot logo em seguida, então
 * `null` sempre devolve alguma persona publicada se existir qualquer uma.
 */
const SLOT_WITHOUT_SUBJECT: BiologicalSex = 'MALE';

/** Persona resolvida + de qual slot ela veio (`null` = default compilado). */
export interface ResolvedPersona {
  persona: AgentPersona;
  servedFromSex: BiologicalSex | null;
}

interface CacheEntry extends ResolvedPersona {
  expiresAt: number;
}

@Injectable()
export class AgentPersonaService implements OnModuleInit, OnModuleDestroy {
  private readonly cached = new Map<BiologicalSex, CacheEntry>();
  private subscriber: Redis | null = null;

  constructor(
    private readonly repo: AgentConfigRepository,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(REDIS_KEY_BUILDER) private readonly keys: RedisKeyBuilder,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AgentPersonaService.name);
  }

  /** Chave do snapshot compartilhado **daquele slot**. */
  cacheKeyFor(targetSex: BiologicalSex): string {
    return this.keys.global(...agentConfigKeySegments(targetSex));
  }

  get channel(): string {
    return this.keys.global(...AGENT_CONFIG_CHANNEL_SEGMENTS);
  }

  onModuleInit(): void {
    // Conexão dedicada: um cliente ioredis em modo subscriber não aceita outros comandos.
    // Falha em assinar não é fatal — o TTL de 60s continua propagando a publicação.
    try {
      this.subscriber = this.redis.duplicate();
      void this.subscriber.subscribe(this.channel);
      this.subscriber.on('message', (_channel: string, payload?: string) => {
        this.invalidate();
        // O payload carrega qual slot foi publicado — só para log/telemetria. A invalidação
        // em si é sempre total (ver cabeçalho): quem estava emprestando também mudou.
        this.logger.info(
          { event: 'agent_config_invalidated', personaSlot: parsePublishedSlot(payload) },
          'cache de persona invalidado nos dois slots',
        );
      });
      this.subscriber.on('error', (err: Error) =>
        this.logger.warn({ event: 'agent_config_subscribe_error', err: err.message }, 'pub/sub'),
      );
    } catch (err) {
      this.subscriber = null;
      this.logger.warn(
        { event: 'agent_config_subscribe_error', err: err instanceof Error ? err.message : err },
        'sem pub/sub de configuração — propagação cai no TTL de 60s',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.quit().catch(() => undefined);
  }

  /**
   * Limpa o cache local dos **dois** slots. Chamado pelo pub/sub e pelo publicador na mesma
   * instância. Nunca invalidar um slot só: o órfão serve o payload do outro.
   */
  invalidate(): void {
    this.cached.clear();
  }

  /**
   * Persona vigente do slot pedido. **Nunca lança**: todo erro cai para o default de código.
   * `null` = sem titular em contexto (ver `SLOT_WITHOUT_SUBJECT`).
   */
  async persona(targetSex: BiologicalSex | null): Promise<AgentPersona> {
    return (await this.resolve(targetSex)).persona;
  }

  /** Nome da agente para superfícies fora do prompt (WhatsApp, copy, transcrição). */
  async agentName(targetSex: BiologicalSex | null): Promise<string> {
    return (await this.persona(targetSex)).agentName;
  }

  /**
   * Resolução completa, com a proveniência. O painel precisa saber se está vendo a persona
   * do próprio slot ou a emprestada do outro — sem isso "não publiquei nada ainda" e "já
   * publiquei" ficam indistinguíveis na tela.
   */
  async resolve(targetSex: BiologicalSex | null): Promise<ResolvedPersona> {
    const slot = targetSex ?? SLOT_WITHOUT_SUBJECT;

    const hit = this.cached.get(slot);
    if (hit && hit.expiresAt > Date.now()) {
      return { persona: hit.persona, servedFromSex: hit.servedFromSex };
    }

    let reason = 'CONFIG_ABSENT';
    const own = await this.load(slot, (failure) => {
      reason = failure;
    });
    let resolved: ResolvedPersona;

    if (own) {
      resolved = { persona: own, servedFromSex: slot };
    } else {
      const other = OTHER_SLOT[slot];
      const borrowed = await this.load(other, () => undefined);
      if (borrowed) {
        this.logger.info(
          {
            event: 'agent_config_fallback',
            reason: 'SLOT_BORROWED',
            personaSlot: slot,
            borrowedFromSlot: other,
          },
          'slot sem persona publicada — atendido pela persona do outro público',
        );
        resolved = { persona: borrowed, servedFromSex: other };
      } else {
        resolved = { persona: this.fallback(reason), servedFromSex: null };
      }
    }

    // O cache é por SLOT PEDIDO: o empréstimo entra aqui já resolvido, e a publicação que o
    // encerra invalida os dois slots — nenhuma leitura fica presa no payload emprestado.
    this.cached.set(slot, { ...resolved, expiresAt: Date.now() + PERSONA_CACHE_TTL_MS });
    return resolved;
  }

  private fallback(reason: string): AgentPersona {
    this.logger.warn(
      { event: 'agent_config_fallback', reason },
      'configuração da agente indisponível — usando o default de código (guardrail compilado)',
    );
    return DEFAULT_AGENT_PERSONA;
  }

  /** Snapshot do slot no Redis; na falta dele, o banco. `null` = slot sem persona utilizável. */
  private async load(
    targetSex: BiologicalSex,
    onFailure: (reason: string) => void,
  ): Promise<AgentPersona | null> {
    return (await this.fromRedis(targetSex)) ?? (await this.fromDatabase(targetSex, onFailure));
  }

  /** Snapshot compartilhado. Redis fora do ar ⇒ `null` ⇒ tenta o banco. */
  private async fromRedis(targetSex: BiologicalSex): Promise<AgentPersona | null> {
    try {
      const raw = await this.redis.get(this.cacheKeyFor(targetSex));
      if (!raw) return null;
      const parsed = agentPersonaStoredSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        this.logger.warn(
          { event: 'agent_config_invalid_payload', source: 'redis' },
          'snapshot de configuração inválido — ignorado',
        );
        return null;
      }
      return parsed.data;
    } catch {
      return null;
    }
  }

  /** Fonte de verdade. Banco fora do ar ou payload inválido ⇒ `null` ⇒ empréstimo/default. */
  private async fromDatabase(
    targetSex: BiologicalSex,
    onFailure: (reason: string) => void,
  ): Promise<AgentPersona | null> {
    try {
      const row = await this.repo.activePayload(targetSex);
      if (!row) return null;
      const parsed = agentPersonaStoredSchema.safeParse(row.payload);
      if (!parsed.success) {
        onFailure('INVALID_PAYLOAD');
        return null;
      }
      return parsed.data;
    } catch {
      onFailure('DATABASE_UNAVAILABLE');
      return null;
    }
  }
}

/**
 * Slot publicado, lido do payload do `PUBLISH`. Antes da Sprint 11 a mensagem era `'1'`, sem
 * dado nenhum — instâncias em versões diferentes durante um deploy ainda podem publicar o
 * formato antigo, então formato desconhecido vira `null` e o log segue.
 */
function parsePublishedSlot(payload: string | undefined): string | null {
  if (!payload) return null;
  try {
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed === 'object' && parsed !== null && 'slot' in parsed) {
      const slot = (parsed as { slot: unknown }).slot;
      return typeof slot === 'string' ? slot : null;
    }
    return null;
  } catch {
    return null;
  }
}

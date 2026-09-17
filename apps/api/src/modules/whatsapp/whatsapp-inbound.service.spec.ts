/**
 * Unit — `WhatsappInboundService` (US-3.1 / US-3.1-EVO). Prova, com fakes:
 *   · payload forjado (HMAC inválido) → descartado, sem enfileirar;
 *   · sem segredo (fail-closed) → descartado;
 *   · replay (mesmo messageId) → descartado no nonce, com namespace POR PROVEDOR;
 *   · remetente desconhecido → descartado;
 *   · orçamento por titular estourado → descartado sem chamar IA;
 *   · rajada de 3 mensagens do mesmo usuário → 1 job (debounce coalesce);
 *   · job enfileirado carrega o contrato de US-3.5 (userId, batchKey, enqueuedAt) sem PII.
 */
import { Redis } from 'ioredis';
import { PinoLogger } from 'nestjs-pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AudioTranscriptionPort } from '../../core/audio/audio-transcription.port';
import type { AppConfigService } from '../../core/config';
import { HealthConsentService } from '../../core/database/health-consent.service';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { DomainEventBus } from '../../core/event-bus/event-bus.service';
import { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import { RedisKeyBuilder } from '../../core/redis/redis-key.util';
import { QueueManager } from '../jobs/queue-manager.service';
import type { EvolutionTransport } from './evolution-transport';
import { AraraInboundEdge } from './inbound/arara-inbound.edge';
import type { WhatsappInboundEdge, WhatsappInboundEdges } from './inbound/whatsapp-inbound-edge';
import { signWebhookBody, SIGNATURE_HEADER, TIMESTAMP_HEADER } from './webhook-signature';
import { type AiResponseJob, WhatsappInboundService } from './whatsapp-inbound.service';

const SECRET = 'unit-webhook-secret';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const PHONE = '+5541999998888';
const INSTANCE_NAME = 'movivo-teste';

/** Fake Redis: SET (com/sem NX), RPUSH, EXPIRE, INCR em memória. */
function fakeRedis(): {
  redis: Redis;
  rpush: ReturnType<typeof vi.fn>;
  keys: string[];
  seed: (key: string, value: string) => void;
} {
  const kv = new Map<string, string>();
  const keys: string[] = [];
  const rpush = vi.fn(async () => 1);
  const redis = {
    async set(key: string, value: string, ...args: unknown[]) {
      keys.push(key);
      if (args.includes('NX') && kv.has(key)) return null;
      kv.set(key, value);
      return 'OK';
    },
    rpush,
    async expire() {
      return 1;
    },
    async incr(key: string) {
      const n = Number(kv.get(key) ?? '0') + 1;
      kv.set(key, String(n));
      return n;
    },
    async get(key: string) {
      return kv.get(key) ?? null;
    },
    async del(key: string) {
      return kv.delete(key) ? 1 : 0;
    },
  } as unknown as Redis;
  return { redis, rpush, keys, seed: (key, value) => kv.set(key, value) };
}

function makeService(
  opts: {
    secret?: string;
    userRows?: Array<{ id: string }>;
    consentActive?: boolean;
    checkinHandled?: boolean;
    evolutionEdge?: WhatsappInboundEdge;
    audioHealthDataApproved?: boolean;
    audioApiKey?: string | undefined;
    audioMaxDurationSeconds?: number;
    transcribe?: ReturnType<typeof vi.fn>;
    evolutionInstanceName?: string | null;
    downloadAudio?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const { redis, rpush, keys, seed } = fakeRedis();
  const enqueue = vi.fn(async () => 'job-1');
  const queues = { enqueue } as unknown as QueueManager;
  const db = {
    runAsSystem: vi.fn(async () => opts.userRows ?? [{ id: USER_ID }]),
  } as unknown as TenantDatabase;
  const config = {
    get whatsapp() {
      return { webhookSecret: 'secret' in opts ? opts.secret : SECRET };
    },
    // OpenAI aprovada por padrão: a maioria dos testes de áudio quer exercitar o caminho
    // feliz sem precisar declarar as flags toda vez; os testes de gate desligam de
    // propósito. Groq fica desligado — a cascata em si (OpenAI → Groq) tem spec própria
    // em `audio-transcription-cascade.spec.ts`/`audio.module.spec.ts`; aqui o
    // `audioTranscription` injetado já é um fake direto (`transcribe`), não a cascata real.
    get audioTranscription() {
      return {
        openaiApiKey: 'audioApiKey' in opts ? opts.audioApiKey : 'sk-fake-openai-key',
        openaiHealthDataApproved: opts.audioHealthDataApproved ?? true,
        groqApiKey: undefined,
        groqHealthDataApproved: false,
        maxDurationSeconds: opts.audioMaxDurationSeconds ?? 120,
        timeoutMs: 20_000,
      };
    },
  } as unknown as AppConfigService;
  const logger = { setContext: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as PinoLogger;
  const hasActiveForUser = vi.fn(async () => opts.consentActive ?? true);
  const revokeForUser = vi.fn(async () => true);
  const healthConsent = {
    hasActiveForUser,
    revokeForUser,
  } as unknown as HealthConsentService;
  const events = {
    request: vi.fn(async () => opts.checkinHandled ?? false),
  } as unknown as DomainEventBus;
  // A borda da EvolutionAPI é exercitada no spec dela; aqui só precisa existir para o
  // mapa ser completo (e para o teste de namespace de nonce por provedor).
  const evolutionEdge: WhatsappInboundEdge = opts.evolutionEdge ?? {
    provider: 'EVOLUTION',
    verify: () => ({ ok: true }),
    normalize: (body: unknown) => [body as never],
  };
  const edges: WhatsappInboundEdges = {
    ARARA: new AraraInboundEdge(config),
    EVOLUTION: evolutionEdge,
  };
  const transcribe = opts.transcribe ?? vi.fn(async () => 'transcrição de teste');
  const audioTranscription = { transcribe } as unknown as AudioTranscriptionPort;
  const downloadAudio =
    opts.downloadAudio ??
    vi.fn(async () => ({ base64: 'YWJj', mimetype: 'audio/ogg; codecs=opus' }));
  const evolutionTransport = {
    lastKnownInstanceName: () =>
      'evolutionInstanceName' in opts ? opts.evolutionInstanceName : INSTANCE_NAME,
    downloadAudio,
  } as unknown as EvolutionTransport;
  const service = new WhatsappInboundService(
    redis,
    new RedisKeyBuilder('movivo'),
    edges,
    audioTranscription,
    evolutionTransport,
    db,
    queues,
    healthConsent,
    events,
    { emit: vi.fn() } as unknown as DashboardQueueEventsService,
    config,
    logger,
  );
  return {
    service,
    enqueue,
    rpush,
    hasActiveForUser,
    revokeForUser,
    events,
    keys,
    seed,
    logger,
    transcribe,
    downloadAudio,
  };
}

function signed(payload: object, secret = SECRET) {
  const raw = Buffer.from(JSON.stringify(payload), 'utf8');
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    provider: 'ARARA' as const,
    rawBody: raw,
    body: payload,
    headers: {
      [SIGNATURE_HEADER]: signWebhookBody(secret, timestamp, raw),
      [TIMESTAMP_HEADER]: timestamp,
    },
  };
}

const payload = (over: Partial<{ messageId: string; from: string; text: string }> = {}) => ({
  messageId: over.messageId ?? 'msg-1',
  from: over.from ?? PHONE,
  text: over.text ?? 'oi movi',
});

describe('WhatsappInboundService.ingest', () => {
  let enqueue: ReturnType<typeof vi.fn>;
  let rpush: ReturnType<typeof vi.fn>;
  let service: WhatsappInboundService;

  beforeEach(() => {
    ({ service, enqueue, rpush } = makeService());
  });

  it('enfileira 1 job com o contrato de US-3.5 para um payload válido', async () => {
    const s = signed(payload());
    await service.ingest({ ...s, correlationId: 'c1' });
    expect(enqueue).toHaveBeenCalledTimes(1);
    const [, jobName, job, overrides] = enqueue.mock.calls[0] as [
      string,
      string,
      AiResponseJob,
      { delay: number },
    ];
    expect(jobName).toBe('coach-response');
    expect(job.userId).toBe(USER_ID);
    expect(job.batchKey).toContain(USER_ID.toLowerCase());
    expect(job).not.toHaveProperty('text'); // nenhum PII no job
    expect(job.enqueuedAt).toBeGreaterThan(0);
    expect(overrides.delay).toBe(7_000);
  });

  it('descarta payload com HMAC inválido (forjado) sem enfileirar', async () => {
    const s = signed(payload());
    await service.ingest({
      ...s,
      headers: { ...s.headers, [SIGNATURE_HEADER]: 'deadbeef' },
      correlationId: 'c2',
    });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('fail-closed: sem segredo configurado, descarta', async () => {
    ({ service, enqueue } = makeService({ secret: undefined }));
    const s = signed(payload());
    await service.ingest({ ...s, correlationId: 'c3' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('descarta replay: mesmo messageId enfileira só uma vez', async () => {
    const s = signed(payload({ messageId: 'dup' }));
    await service.ingest({ ...s, correlationId: 'c4' });
    await service.ingest({ ...s, correlationId: 'c4' });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('nonce é namespaçado por provedor: mesmo id nos dois canais não se anula', async () => {
    const created = makeService();
    const s = signed(payload({ messageId: 'same-id' }));
    await created.service.ingest({ ...s, correlationId: 'arara' });
    await created.service.ingest({
      provider: 'EVOLUTION',
      rawBody: undefined,
      headers: {},
      body: payload({ messageId: 'same-id' }),
      correlationId: 'evo',
    });
    // As duas mensagens chegaram ao buffer: o id colidiu, mas as chaves de nonce vivem em
    // namespaces distintos (com namespace único, a segunda teria sido descartada como
    // replay). O job é um só porque a janela de debounce coalesce — comportamento correto.
    expect(created.rpush).toHaveBeenCalledTimes(2);
    expect(created.keys.some((k) => k.includes('wa-nonce:arara'))).toBe(true);
    expect(created.keys.some((k) => k.includes('wa-nonce:evolution'))).toBe(true);
  });

  it('descarta remetente desconhecido (sem usuário)', async () => {
    ({ service, enqueue } = makeService({ userRows: [] }));
    const s = signed(payload());
    await service.ingest({ ...s, correlationId: 'c5' });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('debounce: rajada de 3 mensagens do mesmo usuário vira 1 job (3 no buffer)', async () => {
    for (let i = 1; i <= 3; i += 1) {
      const s = signed(payload({ messageId: `burst-${i}`, text: `parte ${i}` }));
      await service.ingest({ ...s, correlationId: 'c6' });
    }
    expect(rpush).toHaveBeenCalledTimes(3);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('orçamento por titular estourado: descarta sem enfileirar job de IA', async () => {
    const created = makeService();
    // 30 mensagens/5min é o teto; a 31ª é descartada.
    created.seed(`movivo:u:${USER_ID.toLowerCase()}:inbound-rate`, '30');
    const s = signed(payload({ messageId: 'over-budget' }));
    await created.service.ingest({ ...s, correlationId: 'rate' });
    expect(created.enqueue).not.toHaveBeenCalled();
    expect(created.rpush).not.toHaveBeenCalled();
  });

  it('revogação de consentimento passa mesmo com o orçamento estourado (LGPD Art. 18)', async () => {
    const created = makeService();
    created.seed(`movivo:u:${USER_ID.toLowerCase()}:inbound-rate`, '99');
    const s = signed(payload({ messageId: 'revoke-over', text: 'Revogar consentimento de saude' }));
    await created.service.ingest({ ...s, correlationId: 'rate-revoke' });
    expect(created.revokeForUser).toHaveBeenCalledWith(USER_ID);
  });

  it('revoga HEALTH_DATA somente com a frase explicita e confirma cessacao', async () => {
    const created = makeService();
    const s = signed(payload({ text: 'Revogar consentimento de saude.' }));
    await created.service.ingest({ ...s, correlationId: 'revoke' });
    expect(created.revokeForUser).toHaveBeenCalledWith(USER_ID);
    expect(created.hasActiveForUser).not.toHaveBeenCalled();
    expect(created.enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'health-consent-revoked',
      expect.objectContaining({ type: 'CONSENT_STATUS' }),
      expect.any(Object),
    );
    expect(created.rpush).not.toHaveBeenCalled();
  });

  it('nao revoga por frase aproximada', async () => {
    const created = makeService();
    const s = signed(payload({ text: 'quero revogar depois' }));
    await created.service.ingest({ ...s, correlationId: 'near-revoke' });
    expect(created.revokeForUser).not.toHaveBeenCalled();
    expect(created.rpush).toHaveBeenCalledOnce();
  });

  it('recusa qualquer novo tratamento quando HEALTH_DATA nao esta ativo', async () => {
    const created = makeService({ consentActive: false });
    const s = signed(payload({ text: 'quero falar do treino' }));
    await created.service.ingest({ ...s, correlationId: 'no-consent' });
    expect(created.enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'health-consent-inactive',
      expect.objectContaining({ type: 'CONSENT_STATUS' }),
      expect.any(Object),
    );
    expect(created.rpush).not.toHaveBeenCalled();
    expect(created.events.request).not.toHaveBeenCalled();
  });

  it('roteia check-in pelo barramento sem importar o dominio e nao chama o Coach', async () => {
    const created = makeService({ checkinHandled: true });
    const s = signed(payload({ text: 'dor no quadril' }));
    await created.service.ingest({ ...s, correlationId: 'checkin' });
    expect(created.events.request).toHaveBeenCalledOnce();
    expect(created.rpush).not.toHaveBeenCalled();
    expect(created.enqueue).not.toHaveBeenCalled();
  });

  it('borda rejeita (verify falso) → nada é processado', async () => {
    const created = makeService({
      evolutionEdge: {
        provider: 'EVOLUTION',
        verify: () => ({ ok: false, reason: 'bad_token' }),
        normalize: () => [],
      },
    });
    await created.service.ingest({
      provider: 'EVOLUTION',
      rawBody: undefined,
      headers: {},
      body: payload(),
      correlationId: 'bad-token',
    });
    expect(created.enqueue).not.toHaveBeenCalled();
  });

  it('descarte legítimo da borda ([]) não vira log de rejeição', async () => {
    const created = makeService({
      evolutionEdge: {
        provider: 'EVOLUTION',
        verify: () => ({ ok: true }),
        normalize: () => [],
      },
    });
    await created.service.ingest({
      provider: 'EVOLUTION',
      rawBody: undefined,
      headers: {},
      body: {},
      correlationId: 'discard',
    });
    expect(created.enqueue).not.toHaveBeenCalled();
    const events = (created.logger.info as unknown as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => (call[0] as { event?: string }).event,
    );
    expect(events).toContain('webhook_no_message');
    expect(events).not.toContain('webhook_rejected');
  });
});

describe('WhatsappInboundService.ingest — mensagem de voz (US audio, EvolutionAPI)', () => {
  /** Borda fake que devolve direto uma mensagem de voz — a EvolutionInboundEdge real (que
   * monta `audio.mediaKey` a partir do `key` do Baileys) é testada no spec dela. */
  function audioEdge(audio: { mediaKey: string; durationSeconds?: number }): WhatsappInboundEdge {
    return {
      provider: 'EVOLUTION',
      verify: () => ({ ok: true }),
      normalize: () => [{ messageId: 'aud-1', from: PHONE, audio } as never],
    };
  }

  function ingestAudio(created: ReturnType<typeof makeService>, correlationId = 'audio') {
    return created.service.ingest({
      provider: 'EVOLUTION',
      rawBody: undefined,
      headers: {},
      body: {},
      correlationId,
    });
  }

  it('caminho feliz: baixa, transcreve e segue o pipeline normal — o job nunca carrega o texto', async () => {
    const created = makeService({
      evolutionEdge: audioEdge({ mediaKey: '{"id":"WA-1"}', durationSeconds: 12 }),
      transcribe: vi.fn(async () => 'quantas series eu faço?'),
    });
    await ingestAudio(created);
    expect(created.downloadAudio).toHaveBeenCalledWith(INSTANCE_NAME, '{"id":"WA-1"}');
    expect(created.transcribe).toHaveBeenCalledWith({
      audio: expect.any(Buffer),
      mimeType: 'audio/ogg; codecs=opus',
    });
    expect(created.rpush).toHaveBeenCalledOnce();
    const [, raw] = created.rpush.mock.calls[0] as [string, string];
    expect(JSON.parse(raw)).toMatchObject({ text: 'quantas series eu faço?' });
    // Só o job de ai-response — nenhum aviso de fallback junto.
    expect(created.enqueue).toHaveBeenCalledTimes(1);
    expect(created.enqueue).toHaveBeenCalledWith(
      'ai-response',
      'coach-response',
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('acima do teto de duração: nunca baixa nem transcreve, avisa o aluno', async () => {
    const created = makeService({
      evolutionEdge: audioEdge({ mediaKey: '{"id":"WA-1"}', durationSeconds: 200 }),
      audioMaxDurationSeconds: 120,
    });
    await ingestAudio(created);
    expect(created.downloadAudio).not.toHaveBeenCalled();
    expect(created.transcribe).not.toHaveBeenCalled();
    expect(created.rpush).not.toHaveBeenCalled();
    expect(created.enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'audio-transcription-fallback',
      expect.objectContaining({ type: 'COACH_MESSAGE' }),
      expect.any(Object),
    );
  });

  it('sem aprovação de dado de saúde para STT (gate próprio do ADR-005-R2): não transcreve', async () => {
    const created = makeService({
      evolutionEdge: audioEdge({ mediaKey: '{"id":"WA-1"}' }),
      audioHealthDataApproved: false,
    });
    await ingestAudio(created);
    expect(created.downloadAudio).not.toHaveBeenCalled();
    expect(created.enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'audio-transcription-fallback',
      expect.objectContaining({ type: 'COACH_MESSAGE' }),
      expect.any(Object),
    );
  });

  it('falha ao baixar/transcrever: avisa o aluno e descarta, sem quebrar o pipeline', async () => {
    const created = makeService({
      evolutionEdge: audioEdge({ mediaKey: '{"id":"WA-1"}' }),
      transcribe: vi.fn(async () => {
        throw new Error('provider fora do ar');
      }),
    });
    await ingestAudio(created);
    expect(created.rpush).not.toHaveBeenCalled();
    expect(created.enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'audio-transcription-fallback',
      expect.objectContaining({ type: 'COACH_MESSAGE' }),
      expect.any(Object),
    );
  });

  it('instância da EvolutionAPI ainda desconhecida: avisa e descarta sem tentar baixar', async () => {
    const created = makeService({
      evolutionEdge: audioEdge({ mediaKey: '{"id":"WA-1"}' }),
      evolutionInstanceName: null,
    });
    await ingestAudio(created);
    expect(created.downloadAudio).not.toHaveBeenCalled();
    expect(created.enqueue).toHaveBeenCalledWith(
      'whatsapp-outbound',
      'audio-transcription-fallback',
      expect.objectContaining({ type: 'COACH_MESSAGE' }),
      expect.any(Object),
    );
  });

  it('frase de revogação dita por voz é honrada depois de transcrita', async () => {
    const created = makeService({
      evolutionEdge: audioEdge({ mediaKey: '{"id":"WA-1"}' }),
      transcribe: vi.fn(async () => 'Revogar consentimento de saude'),
    });
    await ingestAudio(created);
    expect(created.revokeForUser).toHaveBeenCalledWith(USER_ID);
  });

  it('orçamento estourado: descarta ANTES de transcrever (nunca gasta com STT)', async () => {
    const created = makeService({ evolutionEdge: audioEdge({ mediaKey: '{"id":"WA-1"}' }) });
    created.seed(`movivo:u:${USER_ID.toLowerCase()}:inbound-rate`, '30');
    await ingestAudio(created);
    expect(created.downloadAudio).not.toHaveBeenCalled();
    expect(created.transcribe).not.toHaveBeenCalled();
    expect(created.enqueue).not.toHaveBeenCalled();
  });
});

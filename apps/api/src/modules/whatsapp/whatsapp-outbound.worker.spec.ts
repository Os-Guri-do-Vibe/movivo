import { DEFAULT_AGENT_PERSONA, type ProtocolStructure } from '@movivo/shared';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

import type { AppConfigService } from '../../core/config';
import type { HealthConsentService } from '../../core/database/health-consent.service';
import { users } from '../../core/database/schema';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import { RedisKeyBuilder } from '../../core/redis/redis-key.util';
import type { WorkerFactory } from '../jobs/worker.factory';
import type { OutboundMessage, WhatsappTransport } from './whatsapp-transport';
import { WhatsappOutboundWorker, type WhatsappOutboundJob } from './whatsapp-outbound.worker';

const USER_ID = '11111111-1111-4111-8111-111111111111';

function structure(): ProtocolStructure {
  return {
    promptVersion: 'v1',
    goal: 'GAIN_MUSCLE',
    phase: 'ADAPTACAO',
    phaseDurationWeeks: 3,
    weeklyFrequency: 3,
    sessions: [
      {
        dayLabel: 'A',
        focus: 'Full',
        exercises: [
          {
            exerciseId: 'goblet_squat',
            name: 'Agachamento',
            sets: 3,
            reps: { min: 8, max: 12 },
            loadStrategy: 'DOUBLE_PROGRESSION',
            restSeconds: 90,
          },
        ],
      },
    ],
  };
}

interface Deps {
  phone?: string | null;
  name?: string | null;
  proto?: {
    id?: string;
    content?: ProtocolStructure;
    status: string;
    approvalStatus: string;
    signedAt?: Date;
    signatureHash?: string;
    professionalId?: string;
    pdfContent?: Buffer;
    totalWeeks?: number;
    mesocycleName?: string;
    reviewUrgency?: string | null;
  } | null;
  markerExists?: boolean;
  consentActive?: boolean;
}

/**
 * tx falso: distingue users/protocols pela tabela passada em `.from()`. A linha de
 * `users` carrega telefone E nome juntos — o fake não sabe distinguir a projeção pedida
 * (`resolvePhone` só lê `.phoneNumber`, `buildDelivery` só lê `.name`), então a mesma
 * linha serve as duas.
 */
function makeTx(deps: Deps) {
  let table: unknown;
  const defaults = { totalWeeks: 12, mesocycleName: 'Mesociclo 1 — Adaptação' };
  const proto =
    deps.proto === undefined
      ? {
          ...defaults,
          id: 'p1',
          content: structure(),
          status: 'ACTIVE',
          approvalStatus: 'AUTO_APPROVED',
          signedAt: new Date(),
          signatureHash: 'a'.repeat(64),
          professionalId: '00000000-0000-4000-8000-000000000001',
        }
      : deps.proto && { ...defaults, ...deps.proto };
  const chain = {
    select: () => chain,
    from: (t: unknown) => {
      table = t;
      return chain;
    },
    where: () => chain,
    orderBy: () => chain,
    limit: () =>
      Promise.resolve(
        table === users
          ? deps.phone === null
            ? []
            : [
                {
                  phoneNumber: deps.phone ?? '+5541999999999',
                  name: deps.name === undefined ? 'Ana Beatriz' : deps.name,
                },
              ]
          : proto
            ? [proto]
            : [],
      ),
  };
  return chain;
}

function makeWorker(deps: Deps = {}) {
  const workers = { create: vi.fn() } as unknown as WorkerFactory;
  const db = {
    runAsUser: vi.fn((_u: string, _r: string, cb: (tx: unknown) => Promise<unknown>) =>
      cb(makeTx(deps)),
    ),
  } as unknown as TenantDatabase;
  const redis = {
    exists: vi.fn(() => Promise.resolve(deps.markerExists ? 1 : 0)),
    set: vi.fn(() => Promise.resolve('OK')),
  } as unknown as Redis;
  const keys = new RedisKeyBuilder('movivo');
  const send = vi.fn((_m: OutboundMessage) => Promise.resolve());
  const sendTyping = vi.fn((_to: string) => Promise.resolve());
  const sendTemplate = vi.fn((_to: string, _templateName: string, _variables?: readonly string[]) =>
    Promise.resolve(),
  );
  const sendDocument = vi.fn(
    (_to: string, _url: string, _caption: string, _fallback?: string, _fileName?: string) =>
      Promise.resolve(),
  );
  const transport = {
    send,
    sendTemplate,
    sendTyping,
    sendDocument,
    hasCredentials: () => true,
  } as unknown as WhatsappTransport;
  const config = {
    whatsapp: { publicSiteUrl: 'https://movivo.test', araraBaseUrl: '', araraApiKey: undefined },
  } as unknown as AppConfigService;
  const logger = { info: vi.fn(), warn: vi.fn(), setContext: vi.fn() } as never;
  const worker = new WhatsappOutboundWorker(
    workers,
    db,
    redis,
    keys,
    transport,
    {
      hasActiveForUser: vi.fn(async () => deps.consentActive ?? true),
    } as unknown as HealthConsentService,
    config,
    {
      agentName: vi.fn(async () => DEFAULT_AGENT_PERSONA.agentName),
      persona: vi.fn(async () => DEFAULT_AGENT_PERSONA),
    } as never,
    logger,
  );
  return { worker, send, sendTemplate, sendTyping, sendDocument, redis };
}

function job(data: Partial<WhatsappOutboundJob>): Job<WhatsappOutboundJob> {
  return { data: { userId: USER_ID, type: 'CONFIRMATION', ...data } } as Job<WhatsappOutboundJob>;
}

describe('WhatsappOutboundWorker.process (US-2.5)', () => {
  it('PHONE_VERIFICATION: usa Template (fora da janela de 24h), não texto livre', async () => {
    const { worker, send, sendTemplate } = makeWorker();
    const res = await worker.process(
      job({
        userId: null,
        type: 'PHONE_VERIFICATION',
        phoneNumber: '+5541999999999',
        code: '123456',
      }),
    );
    expect(res.status).toBe('SENT');
    expect(sendTemplate).toHaveBeenCalledWith('+5541999999999', 'verificacao_numero', ['123456']);
    expect(send).not.toHaveBeenCalled();
  });

  it('PHONE_VERIFICATION sem telefone ou código: descarta sem enviar', async () => {
    const { worker, sendTemplate } = makeWorker();
    const res = await worker.process(job({ userId: null, type: 'PHONE_VERIFICATION' }));
    expect(res.status).toBe('INVALID');
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('descarta outbound de saude enfileirado antes da revogacao', async () => {
    const { worker, send } = makeWorker({ consentActive: false });
    await expect(
      worker.process(job({ type: 'CHECKIN_MESSAGE', text: 'check-in' })),
    ).resolves.toEqual({ status: 'CONSENT_REVOKED' });
    expect(send).not.toHaveBeenCalled();
  });

  it('permite confirmacao de revogacao mesmo sem consentimento ativo', async () => {
    const { worker, send } = makeWorker({ consentActive: false });
    await expect(
      worker.process(job({ type: 'CONSENT_STATUS', text: 'consentimento revogado' })),
    ).resolves.toEqual({ status: 'SENT' });
    expect(send).toHaveBeenCalledOnce();
  });

  it('confirmação: envia uma bolha e marca como enviado', async () => {
    const { worker, send, redis } = makeWorker();
    const res = await worker.process(job({ type: 'CONFIRMATION' }));
    expect(res.status).toBe('SENT');
    expect(send).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalled();
  });

  it('variante de cuidado é enviada para PAR-Q de risco', async () => {
    const { worker, send } = makeWorker();
    await worker.process(job({ type: 'CONFIRMATION_CARE' }));
    expect(send.mock.calls[0]?.[0]?.text).toMatch(/revisar/i);
  });

  it('COACH_MESSAGE: envia o texto dinâmico em bolhas (US-3.5)', async () => {
    const { worker, send } = makeWorker();
    const res = await worker.process(
      job({ type: 'COACH_MESSAGE', text: 'Oi!\n---\nComo foi o treino?', dedupeId: 'c1' }),
    );
    expect(res.status).toBe('SENT');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('TYPING: dispara o indicador de digitação, sem marcador nem texto (US-3.5)', async () => {
    const { worker, send, sendTyping } = makeWorker();
    const res = await worker.process(job({ type: 'TYPING' }));
    expect(res.status).toBe('TYPING');
    expect(sendTyping).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });

  it('entrega AUTO_APPROVED/ACTIVE: envia 4 bolhas (com a explicação do plano) e emite protocol_sent', async () => {
    const { worker, send } = makeWorker();
    const res = await worker.process(
      job({ type: 'PROTOCOL_DELIVERY', protocolId: 'p1', protocolVersion: 1 }),
    );
    expect(res.status).toBe('SENT');
    expect(send).toHaveBeenCalledTimes(4);
    // Bolha 2: contexto do plano, com o mesociclo e a duração vindos da linha do protocolo.
    expect(send.mock.calls[1]?.[0]?.text).toContain('Mesociclo 1 — Adaptação');
    expect(send.mock.calls[1]?.[0]?.text).toContain('12 semanas');
    expect(send.mock.calls[3]?.[0]?.text).toContain('https://movivo.test/protocolo/p1');
  });

  it('entrega com PDF: manda o texto explicativo E o documento, com um marcador só', async () => {
    const { worker, send, sendDocument, redis } = makeWorker({
      name: 'Ana Beatriz Souza',
      proto: {
        id: 'p1',
        content: structure(),
        status: 'ACTIVE',
        approvalStatus: 'HUMAN_APPROVED',
        signedAt: new Date(),
        signatureHash: 'a'.repeat(64),
        professionalId: '00000000-0000-4000-8000-000000000001',
        pdfContent: Buffer.from('%PDF-1.4'),
      },
    });
    const res = await worker.process(
      job({ type: 'PROTOCOL_DELIVERY', protocolId: 'p1', protocolVersion: 1 }),
    );
    expect(res.status).toBe('SENT');
    // Com PDF, o texto vira só intro + contexto (achado 2026-08-25) — o anexo já é o
    // plano completo, sem prévia de treino nem link redundante ao lado do PDF real.
    expect(send).toHaveBeenCalledTimes(2);
    expect(sendDocument).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledTimes(1);
    const [, url, caption, , fileName] = sendDocument.mock.calls[0] ?? [];
    expect(url).toBe('https://movivo.test/protocolo/p1/pdf');
    expect(fileName).toBe('protocolo-ana-beatriz-souza-movivo.pdf');
    // Assinado por humano: a legenda pode afirmar a revisão.
    expect(caption).toMatch(/Revisado e assinado/i);
  });

  it('entrega com PDF auto-liberado: a legenda NÃO afirma revisão humana', async () => {
    const { worker, sendDocument } = makeWorker({
      proto: {
        id: 'p1',
        content: structure(),
        status: 'ACTIVE',
        approvalStatus: 'AUTO_APPROVED',
        signedAt: new Date(),
        signatureHash: 'a'.repeat(64),
        professionalId: '00000000-0000-4000-8000-000000000001',
        pdfContent: Buffer.from('%PDF-1.4'),
      },
    });
    await worker.process(job({ type: 'PROTOCOL_DELIVERY', protocolId: 'p1', protocolVersion: 1 }));
    const caption = sendDocument.mock.calls[0]?.[2];
    expect(caption).not.toMatch(/revisou|revisado|assinou|assinado/i);
    expect(caption).toMatch(/metodologia do profissional de Educação Física registrado no CREF/i);
  });

  it('entrega com PDF: falha no texto explicativo não impede o envio do documento', async () => {
    const { worker, send, sendDocument } = makeWorker({
      proto: {
        id: 'p1',
        content: structure(),
        status: 'ACTIVE',
        approvalStatus: 'HUMAN_APPROVED',
        signedAt: new Date(),
        signatureHash: 'a'.repeat(64),
        professionalId: '00000000-0000-4000-8000-000000000001',
        pdfContent: Buffer.from('%PDF-1.4'),
      },
    });
    send.mockRejectedValueOnce(new Error('transport 500'));
    const res = await worker.process(
      job({ type: 'PROTOCOL_DELIVERY', protocolId: 'p1', protocolVersion: 1 }),
    );
    expect(res.status).toBe('SENT');
    expect(sendDocument).toHaveBeenCalledTimes(1);
  });

  it('entrega com PDF, sem nome cadastrado: cai no nome de arquivo genérico', async () => {
    const { worker, sendDocument } = makeWorker({
      name: null,
      proto: {
        id: 'p1',
        content: structure(),
        status: 'ACTIVE',
        approvalStatus: 'AUTO_APPROVED',
        signedAt: new Date(),
        signatureHash: 'a'.repeat(64),
        professionalId: '00000000-0000-4000-8000-000000000001',
        pdfContent: Buffer.from('%PDF-1.4'),
      },
    });
    await worker.process(job({ type: 'PROTOCOL_DELIVERY', protocolId: 'p1', protocolVersion: 1 }));
    const [, , , , fileName] = sendDocument.mock.calls[0] ?? [];
    expect(fileName).toBe('protocolo-movivo.pdf');
  });

  it('entrega bloqueada: protocolo não aprovado não envia nada', async () => {
    const { worker, send } = makeWorker({
      proto: { status: 'PENDING_SIGNATURE', approvalStatus: 'PENDING_REVIEW' },
    });
    const res = await worker.process(job({ type: 'PROTOCOL_DELIVERY', protocolVersion: 1 }));
    expect(res.status).toBe('SKIPPED');
    expect(send).not.toHaveBeenCalled();
  });

  it('idempotência: marcador presente → não reenvia', async () => {
    const { worker, send } = makeWorker({ markerExists: true });
    const res = await worker.process(job({ type: 'PROTOCOL_DELIVERY', protocolVersion: 1 }));
    expect(res.status).toBe('ALREADY_SENT');
    expect(send).not.toHaveBeenCalled();
  });

  it('sem telefone → não envia', async () => {
    const { worker, send } = makeWorker({ phone: null });
    const res = await worker.process(job({ type: 'PROTOCOL_WAITING' }));
    expect(res.status).toBe('NO_PHONE');
    expect(send).not.toHaveBeenCalled();
  });

  it('espera (30min do submit): sem protocolo ainda, a agente se apresenta e promete o plano', async () => {
    const { worker, send } = makeWorker({ proto: null });
    const res = await worker.process(job({ type: 'PROTOCOL_WAITING' }));
    expect(res.status).toBe('SENT');
    expect(send).toHaveBeenCalledTimes(1);
    const text = send.mock.calls[0]?.[0]?.text ?? '';
    expect(text).toContain(DEFAULT_AGENT_PERSONA.agentName);
    expect(text).toMatch(/analisando as informações/i);
    expect(text).toMatch(/Logo te mando o plano completo/i);
  });

  it('espera (30min do submit): PAR-Q bloqueado (MANDATORY) anuncia revisão humana, sem prazo', async () => {
    const { worker, send } = makeWorker({
      proto: {
        status: 'PENDING_SIGNATURE',
        approvalStatus: 'PENDING_REVIEW',
        reviewUrgency: 'MANDATORY',
      },
    });
    const res = await worker.process(job({ type: 'PROTOCOL_WAITING' }));
    expect(res.status).toBe('SENT');
    const text = send.mock.calls[0]?.[0]?.text ?? '';
    expect(text).toMatch(/profissional de Educação Física registrado no CREF/i);
    expect(text).toMatch(/esse profissional vai olhar/i);
    expect(text).not.toMatch(/logo te mando/i);
  });

  it('espera (30min do submit): revisão OPTIONAL ainda pendente usa a variante com prazo', async () => {
    const { worker, send } = makeWorker({
      proto: {
        status: 'PENDING_SIGNATURE',
        approvalStatus: 'PENDING_REVIEW',
        reviewUrgency: 'OPTIONAL',
      },
    });
    await worker.process(job({ type: 'PROTOCOL_WAITING' }));
    expect(send.mock.calls[0]?.[0]?.text).toMatch(/Logo te mando o plano completo/i);
  });

  it('espera (30min do submit): entrega já saiu nesse meio tempo → não manda nada', async () => {
    // Default de `makeTx` já é um protocolo ACTIVE/AUTO_APPROVED — reconfirmado na hora
    // do envio (não só no enqueue), então a apresentação "já estou analisando" não sai
    // depois que a entrega real já resolveu.
    const { worker, send } = makeWorker({});
    const res = await worker.process(job({ type: 'PROTOCOL_WAITING' }));
    expect(res.status).toBe('SKIPPED');
    expect(send).not.toHaveBeenCalled();
  });
});

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
  /**
   * Marker de `wa-sent:PROTOCOL_WAITING:na` — separado de `markerExists` (o marker do job
   * corrente) porque a entrega adiantada (achado 2026-09-04) checa essa chave ANTES de
   * mandar o protocolo, pra decidir se manda a apresentação primeiro. Default `undefined`
   * (não existe ainda): testes de entrega que não se importam com a apresentação passam
   * `true` pra isolar o que estão testando.
   */
  waitingMarkerExists?: boolean;
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
  const defaults = { totalWeeks: 12, mesocycleName: 'Mesociclo 1: Adaptação' };
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
  const keys = new RedisKeyBuilder('movivo');
  // Mesma chave que `PROTOCOL_WAITING` usa como marker principal E que a entrega adiantada
  // (achado 2026-09-04) checa como marker SECUNDÁRIO — por isso o fake distingue pela
  // chave, não por um único booleano: um job `PROTOCOL_DELIVERY` consulta as DUAS chaves
  // (a sua própria e esta), um job `PROTOCOL_WAITING` só consulta esta.
  const waitingKey = keys.forUser(USER_ID, 'wa-sent', 'PROTOCOL_WAITING', 'na');
  const redis = {
    exists: vi.fn((key: string) =>
      Promise.resolve((key === waitingKey ? deps.waitingMarkerExists : deps.markerExists) ? 1 : 0),
    ),
    set: vi.fn(() => Promise.resolve('OK')),
  } as unknown as Redis;
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

  it('confirmação: envia uma bolha saudando pelo primeiro nome e marca como enviado', async () => {
    const { worker, send, redis } = makeWorker({ name: 'Ana Beatriz' });
    const res = await worker.process(job({ type: 'CONFIRMATION' }));
    expect(res.status).toBe('SENT');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]?.text).toMatch(/^Olá, Ana!/);
    expect(redis.set).toHaveBeenCalled();
  });

  it('confirmação sem nome salvo: saúda genericamente', async () => {
    const { worker, send } = makeWorker({ name: null });
    await worker.process(job({ type: 'CONFIRMATION' }));
    expect(send.mock.calls[0]?.[0]?.text).toMatch(/^Olá!/);
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

  // Decisão do fundador (2026-09-12): entrega por texto+link (protocolo sem PDF) foi
  // REMOVIDA — nunca mais degrada silenciosamente. Falha e usa o retry/DLQ genéricos.
  it('protocolo aprovado/assinado sem PDF: falha (retry automático + DLQ), nunca degrada para texto+link', async () => {
    const { worker, send, sendDocument } = makeWorker({ waitingMarkerExists: true });
    await expect(
      worker.process(job({ type: 'PROTOCOL_DELIVERY', protocolId: 'p1', protocolVersion: 1 })),
    ).rejects.toThrow(/sem PDF gerado/);
    expect(send).not.toHaveBeenCalled();
    expect(sendDocument).not.toHaveBeenCalled();
  });

  it('entrega com PDF, sem resumo de IA: a saudação vai só na legenda do documento, nenhuma bolha antes', async () => {
    const { worker, send, sendDocument, redis } = makeWorker({
      waitingMarkerExists: true,
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
    // Achado 2026-09-04 (reproduzido ao vivo, print real de WhatsApp): a saudação saía como
    // bolha ANTES do documento E de novo como legenda dele — duplicada. Agora é uma mensagem
    // só: a legenda do documento.
    expect(send).not.toHaveBeenCalled();
    expect(sendDocument).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledTimes(1);
    const [, url, caption, , fileName] = sendDocument.mock.calls[0] ?? [];
    expect(url).toBe('https://movivo.test/protocolo/p1/pdf');
    expect(fileName).toBe('protocolo-ana-beatriz-souza-movivo.pdf');
    expect(caption).toMatch(/^Ana, seu treino está pronto!/);
  });

  // Achado 2026-09-08 (bug reproduzido ao vivo pelo fundador): a reentrega pós-substituição
  // usava a MESMA saudação de "seu treino está pronto! Montamos tudo com base nos seus
  // objetivos..." da 1ª entrega, como se fosse a primeira vez — sem nunca dizer que era uma
  // ATUALIZAÇÃO por causa da troca de exercício que o aluno pediu.
  it('entrega pós-substituição (`deliveryReason: SUBSTITUTION`): saudação nomeia a troca, não repete a de 1ª entrega', async () => {
    const { worker, sendDocument } = makeWorker({
      waitingMarkerExists: true,
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
      job({
        type: 'PROTOCOL_DELIVERY',
        protocolId: 'p1',
        protocolVersion: 1,
        deliveryReason: 'SUBSTITUTION',
        substitutionFromExercise: 'Caminhada de Mala (Halter)',
        substitutionToExercise: 'Esteira',
      }),
    );
    expect(res.status).toBe('SENT');
    const caption = sendDocument.mock.calls[0]?.[2] as string;
    expect(caption).toMatch(/^Ana, a troca do seu exercício já foi feita!/);
    expect(caption).toContain('"Caminhada de Mala (Halter)" virou "Esteira"');
    expect(caption).not.toContain('seu treino está pronto');
  });

  it('entrega com PDF e resumo de IA (`data.text`): saudação + resumo viram UMA legenda só, nenhuma bolha antes', async () => {
    const { worker, send, sendDocument } = makeWorker({
      waitingMarkerExists: true,
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
      job({
        type: 'PROTOCOL_DELIVERY',
        protocolId: 'p1',
        protocolVersion: 1,
        text: 'Seu treino trabalha corpo inteiro 3x por semana, com foco em técnica.',
      }),
    );
    expect(res.status).toBe('SENT');
    // Achado 2026-09-04: o resumo da IA não sai mais como 3ª bolha à parte (chegava a se
    // reapresentar como "Leonardo" de novo e a afirmar "o PDF já foi enviado" antes de sair)
    // — entra junto na MESMA legenda do documento, separado por parágrafo.
    expect(send).not.toHaveBeenCalled();
    expect(sendDocument).toHaveBeenCalledTimes(1);
    const caption = sendDocument.mock.calls[0]?.[2];
    expect(caption).toMatch(/^Ana, seu treino está pronto!/);
    expect(caption).toContain(
      'Seu treino trabalha corpo inteiro 3x por semana, com foco em técnica.',
    );
    expect(caption).not.toContain('---');
  });

  it('achado 2026-09-04: aprovação antes dos 30min manda a apresentação ANTES da entrega, e marca PROTOCOL_WAITING como enviado', async () => {
    const { worker, send, sendDocument, redis } = makeWorker({
      // Sem `waitingMarkerExists`: simula o caso que motivou a mudança — o profissional
      // assinou antes do job de 30min disparar, então a apresentação nunca saiu ainda.
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
    // Única bolha: apresentação da agente (`agentSelfIntro`, via `analyzingMessage`) — a
    // saudação da entrega não sai mais como bolha própria, só como legenda do documento
    // (achado 2026-09-04, ver testes acima). A ORDEM apresentação→entrega continua sendo
    // o ponto desta mudança: a apresentação sai ANTES do documento.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]?.text).toBe(DEFAULT_AGENT_PERSONA.agentSelfIntro);
    expect(sendDocument).toHaveBeenCalledTimes(1);
    expect(sendDocument.mock.calls[0]?.[2]).toMatch(/^Ana, seu treino está pronto!/);
    // Marca o MESMO marker que um job `PROTOCOL_WAITING` real usaria — quando ele disparar
    // depois (o delay do BullMQ não é cancelável), vira `ALREADY_SENT` sem duplicar.
    const waitingKey = new RedisKeyBuilder('movivo').forUser(
      USER_ID,
      'wa-sent',
      'PROTOCOL_WAITING',
      'na',
    );
    expect(redis.set).toHaveBeenCalledWith(waitingKey, '1', 'EX', expect.any(Number));
  });

  it('achado 2026-09-04: se a apresentação já saiu (30min normais), a entrega não repete', async () => {
    const { worker, send, sendDocument } = makeWorker({
      waitingMarkerExists: true,
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
    // `waitingMarkerExists: true` já cobre a apresentação — a entrega manda só o documento,
    // nenhuma bolha extra de apresentação antes.
    expect(send).not.toHaveBeenCalled();
    expect(sendDocument).toHaveBeenCalledTimes(1);
  });

  it('entrega com PDF auto-liberado: a legenda é a mesma saudação, independente de revisão humana', async () => {
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
    expect(caption).toMatch(/^Ana, seu treino está pronto!/);
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

  it('espera (30min do submit): sem protocolo ainda, é só a apresentação do agente (exceção deliberada)', async () => {
    const { worker, send } = makeWorker({ proto: null });
    const res = await worker.process(job({ type: 'PROTOCOL_WAITING' }));
    expect(res.status).toBe('SENT');
    expect(send).toHaveBeenCalledTimes(1);
    const text = send.mock.calls[0]?.[0]?.text ?? '';
    expect(text).toContain(DEFAULT_AGENT_PERSONA.agentName);
    expect(text).not.toMatch(/analisando as informações|intelig[êe]ncia artificial/i);
  });

  it('espera (30min do submit): MANDATORY (PAR-Q bloqueado) e OPTIONAL mandam o MESMO texto', async () => {
    // Achado 2026-09-04 (a pedido do fundador, reproduzido ao vivo): a variante MANDATORY
    // chegou a sair pro fundador em teste quando o esperado era a apresentação normal do
    // agente — unificado, `reviewUrgency` não decide mais o texto desta mensagem.
    const mandatory = makeWorker({
      proto: {
        status: 'PENDING_SIGNATURE',
        approvalStatus: 'PENDING_REVIEW',
        reviewUrgency: 'MANDATORY',
      },
    });
    const res = await mandatory.worker.process(job({ type: 'PROTOCOL_WAITING' }));
    expect(res.status).toBe('SENT');
    const mandatoryText = mandatory.send.mock.calls[0]?.[0]?.text ?? '';
    expect(mandatoryText).toContain(DEFAULT_AGENT_PERSONA.agentName);
    expect(mandatoryText).not.toMatch(/analisando as informações|intelig[êe]ncia artificial/i);

    const optional = makeWorker({
      proto: {
        status: 'PENDING_SIGNATURE',
        approvalStatus: 'PENDING_REVIEW',
        reviewUrgency: 'OPTIONAL',
      },
    });
    await optional.worker.process(job({ type: 'PROTOCOL_WAITING' }));
    const optionalText = optional.send.mock.calls[0]?.[0]?.text ?? '';
    expect(optionalText).toBe(mandatoryText);
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

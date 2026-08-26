import { BadRequestException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';

import { HealthCipherService } from '../../core/database/health-cipher.service';
import { HealthConsentService } from '../../core/database/health-consent.service';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { QueueManager } from '../jobs/queue-manager.service';
import { ValidationService } from '../protocol/validation/validation.service';
import { AuditService } from './audit.service';
import { DashboardService } from './dashboard.service';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';
const RESOURCE_ID = '33333333-3333-4333-8333-333333333333';
const SESSION_ID = '77777777-7777-4777-8777-777777777777';
const actor: AuthenticatedUser = { userId: ACTOR_ID, role: 'PROFESSIONAL', jti: 'jti' };
const admin: AuthenticatedUser = { userId: ACTOR_ID, role: 'ADMIN', jti: 'jti' };

const content = {
  promptVersion: 'v1',
  goal: 'CONDITIONING',
  phase: 'ADAPTACAO',
  weeklyFrequency: 1,
  sessions: [
    {
      dayLabel: 'Dia 1',
      focus: 'Corpo inteiro',
      exercises: [
        {
          exerciseId: 'goblet_squat',
          name: 'Agachamento',
          sets: 3,
          reps: { min: 8, max: 12 },
          loadStrategy: 'BODYWEIGHT',
          restSeconds: 60,
        },
      ],
    },
  ],
} as const;

/** Consentimento de saúde ativo é pré-condição de QUALQUER assinatura (2026-08-24). */
function consentService(active = true) {
  return { hasActiveForUser: vi.fn(async () => active) } as unknown as HealthConsentService;
}

function makeService(row: Record<string, unknown>, verdict: 'PASS' | 'FLAG_HUMAN_REVIEW' = 'PASS') {
  const chain = {
    from: () => chain,
    where: () => chain,
    for: () => chain,
    limit: async () => [row],
  };
  const update = vi.fn();
  const insert = vi.fn();
  const execute = vi.fn();
  const tx = { select: () => chain, update, insert, execute } as never;
  const db = {
    runAsUser: vi.fn((_id: string, _role: string, callback: (value: unknown) => Promise<unknown>) =>
      callback(tx),
    ),
  } as unknown as TenantDatabase;
  const validation = {
    validate: vi.fn(() => ({
      action: verdict,
      code: verdict === 'PASS' ? 'PASS' : 'FLAG',
      humanReviewRequired: verdict !== 'PASS',
      violations: verdict === 'PASS' ? [] : [{ rule: 'LANGUAGE', detail: 'flag', action: 'FLAG' }],
    })),
  } as unknown as ValidationService;
  const append = vi.fn(async (..._args: Parameters<AuditService['append']>) => undefined);
  const audit = { append } as unknown as AuditService;
  const enqueue = vi.fn(async () => 'job');
  const queues = { enqueue } as unknown as QueueManager;
  const logger = { setContext: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as PinoLogger;
  const service = new DashboardService(
    db,
    validation,
    {} as HealthCipherService,
    audit,
    queues,
    { emit: vi.fn(), stream: vi.fn() } as unknown as DashboardQueueEventsService,
    consentService(),
    logger,
  );
  return { service, enqueue, append, update, insert, execute };
}

function makeSequencedService(
  selections: unknown[][],
  verdict: 'PASS' | 'FLAG_HUMAN_REVIEW' = 'PASS',
  decrypted: string[] = [],
  consentActive = true,
) {
  const updateWhere = vi.fn(async () => []);
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const insertValues = vi.fn(async () => []);
  const execute = vi.fn(async () => []);
  const forUpdate = vi.fn();
  const tx = {
    select: vi.fn(() => {
      const result = selections.shift() ?? [];
      const chain: Record<string, unknown> = {};
      for (const method of ['from', 'leftJoin', 'innerJoin', 'where', 'orderBy']) {
        chain[method] = () => chain;
      }
      chain.for = (...args: unknown[]) => {
        forUpdate(...args);
        return chain;
      };
      chain.limit = async () => result;
      chain.then = (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return chain;
    }),
    update: vi.fn(() => ({ set: updateSet })),
    insert: vi.fn(() => ({ values: insertValues })),
    execute,
  } as never;
  const db = {
    runAsUser: vi.fn((_id: string, _role: string, callback: (value: unknown) => Promise<unknown>) =>
      callback(tx),
    ),
  } as unknown as TenantDatabase;
  const validation = {
    validate: vi.fn(() => ({
      action: verdict,
      code: verdict === 'PASS' ? 'PASS' : 'FLAG',
      humanReviewRequired: verdict !== 'PASS',
      violations: verdict === 'PASS' ? [] : [{ rule: 'LANGUAGE', detail: 'flag', action: 'FLAG' }],
    })),
  } as unknown as ValidationService;
  const append = vi.fn(async (..._args: Parameters<AuditService['append']>) => undefined);
  const decryptHealth = vi.fn(async () => decrypted.shift() ?? JSON.stringify({}));
  const enqueue = vi.fn(async () => 'job');
  const emit = vi.fn();
  const service = new DashboardService(
    db,
    validation,
    { decryptHealth } as unknown as HealthCipherService,
    { append } as unknown as AuditService,
    { enqueue } as unknown as QueueManager,
    { emit, stream: vi.fn() } as unknown as DashboardQueueEventsService,
    consentService(consentActive),
    { setContext: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() } as unknown as PinoLogger,
  );
  return {
    service,
    append,
    enqueue,
    updateSet,
    updateWhere,
    insertValues,
    execute,
    decryptHealth,
    forUpdate,
    emit,
  };
}

const pendingProtocol = {
  id: RESOURCE_ID,
  userId: USER_ID,
  createdAt: new Date('2026-08-01T12:00:00.000Z'),
  content,
  constraints: { goal: 'CONDITIONING', injuryTags: [] },
  parQFlags: [],
  status: 'PENDING_SIGNATURE',
  approvalStatus: 'PENDING_REVIEW',
  version: 1,
  signedAt: null,
  signatureHash: null,
  professionalId: null,
  humanReviewRequired: true,
  reviewUrgency: 'OPTIONAL' as const,
  generatedBy: 'AI_WITH_RULES',
  totalWeeks: 12,
};

describe('DashboardService invariantes de mutacao', () => {
  it('rejeita edicao com qualquer veredito diferente de PASS', async () => {
    const { service, update, append } = makeService(
      {
        id: RESOURCE_ID,
        userId: USER_ID,
        content,
        constraints: { goal: 'CONDITIONING', injuryTags: [] },
        parQFlags: [],
      },
      'FLAG_HUMAN_REVIEW',
    );
    await expect(
      service.editProtocol(actor, RESOURCE_ID, { content, reason: 'revisao segura' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it('retry de protocolo ja assinado nao cria versao, auditoria ou nova entrega', async () => {
    const signedAt = new Date('2026-08-03T12:00:00.000Z');
    const { service, enqueue, insert, update, append } = makeService({
      id: RESOURCE_ID,
      userId: USER_ID,
      status: 'ACTIVE',
      version: 2,
      signedAt,
      signatureHash: 'a'.repeat(64),
      professionalId: ACTOR_ID,
    });
    await expect(
      service.signProtocol(actor, RESOURCE_ID, { confirmation: true }),
    ).resolves.toMatchObject({ version: 2, alreadySigned: true });
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('edita protocolo seguro, invalida assinatura anterior e audita hashes', async () => {
    const { service, updateSet, updateWhere, append, forUpdate } = makeSequencedService([
      [pendingProtocol],
    ]);
    await expect(
      service.editProtocol(actor, RESOURCE_ID, { content, reason: 'ajuste revisado pelo RT' }),
    ).resolves.toMatchObject({ status: 'PENDING_SIGNATURE', validation: 'PASS' });
    expect(updateWhere).toHaveBeenCalledOnce();
    // Conteúdo editado por humano nunca sai sozinho: mesmo que o protocolo fosse
    // `OPTIONAL` (fixture `pendingProtocol`), a edição força `MANDATORY`.
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({ reviewUrgency: 'MANDATORY' }));
    expect(forUpdate).toHaveBeenCalledWith('update');
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'PROTOCOL_EDITED',
        userId: USER_ID,
        changes: expect.objectContaining({ reasonHash: expect.any(String) }),
      }),
    );
    expect(append.mock.calls[0]?.[1].changes).not.toHaveProperty('reason');
  });

  it('assina com CREF ativo, cria versao imutavel e entrega', async () => {
    const professional = { crefActive: true, crefNumber: '123456', crefRegion: 'SP' };
    const { service, updateWhere, insertValues, append, enqueue } = makeSequencedService([
      [pendingProtocol],
      [professional],
    ]);
    await expect(
      service.signProtocol(actor, RESOURCE_ID, { confirmation: true }),
    ).resolves.toMatchObject({ id: RESOURCE_ID, version: 2, alreadySigned: false });
    expect(updateWhere).toHaveBeenCalledOnce();
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }));
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'PROTOCOL_SIGNED' }),
    );
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it('ADMIN assina sem credencial CREF (conta fundador, achado 2026-08-22)', async () => {
    const { service, updateWhere, insertValues, append, enqueue } = makeSequencedService([
      [pendingProtocol],
      // Só uma seleção (o `requireProtocol`): ADMIN pula o select de checagem de CREF.
    ]);
    await expect(
      service.signProtocol(admin, RESOURCE_ID, { confirmation: true }),
    ).resolves.toMatchObject({ id: RESOURCE_ID, version: 2, alreadySigned: false });
    expect(updateWhere).toHaveBeenCalledOnce();
    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ version: 2 }));
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'PROTOCOL_SIGNED' }),
    );
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it('conteudo salvo que nao passa mais no schema atual falha com 400 explicito, nunca 500 generico', async () => {
    // Achado 2026-08-22: `protocolStructureSchema.parse(row.content)` era um `.parse()`
    // direto sem try/catch — um `ZodError` não é `HttpException`, e o filtro padrão do
    // Nest vira "Internal server error" sem pista nenhuma. `sessions` vazio viola
    // `.min(1)` do schema atual; simula conteúdo salvo antes de uma regra ficar mais
    // restrita (ou corrompido) chegando na assinatura.
    const invalidContentProtocol = { ...pendingProtocol, content: { ...content, sessions: [] } };
    const { service } = makeSequencedService([[invalidContentProtocol]]);
    const promise = service.signProtocol(admin, RESOURCE_ID, { confirmation: true });
    await expect(promise).rejects.toBeInstanceOf(BadRequestException);
    const error = (await promise.catch((caught: unknown) => caught)) as BadRequestException;
    expect(error.getResponse()).toMatchObject({ code: 'PROTOCOL_CONTENT_INVALID' });
  });

  it('bloqueia assinatura fora do estado pendente ou sem CREF ativo', async () => {
    const activeWithoutSignature = { ...pendingProtocol, status: 'ACTIVE' };
    const first = makeSequencedService([[activeWithoutSignature]]).service;
    await expect(
      first.signProtocol(actor, RESOURCE_ID, { confirmation: true }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const second = makeSequencedService([[pendingProtocol], [{ crefActive: false }]]).service;
    await expect(
      second.signProtocol(actor, RESOURCE_ID, { confirmation: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('bloqueia assinatura quando a revalidacao nao retorna PASS', async () => {
    const { service } = makeSequencedService(
      [[pendingProtocol], [{ crefActive: true, crefNumber: '1', crefRegion: 'SP' }]],
      'FLAG_HUMAN_REVIEW',
    );
    await expect(
      service.signProtocol(actor, RESOURCE_ID, { confirmation: true }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  /**
   * 2026-08-24: a liberação de PAR-Q não tem mais ação nem tela próprias — acontece
   * DENTRO da assinatura do protocolo, na mesma transação. `release_parq_on_signature`
   * devolve o titular quando de fato liberou, e `NULL` quando não havia nada a liberar.
   */
  it('assinatura de protocolo com PAR-Q bloqueado libera o PAR-Q e audita o ato separado', async () => {
    const parqProtocol = {
      ...pendingProtocol,
      reviewUrgency: 'MANDATORY' as const,
      anamnesisSessionId: SESSION_ID,
    };
    const { service, append, execute } = makeSequencedService([[parqProtocol]]);
    (execute as ReturnType<typeof vi.fn>).mockResolvedValue([{ user_id: USER_ID }]);

    await expect(
      service.signProtocol(admin, RESOURCE_ID, { confirmation: true }),
    ).resolves.toMatchObject({ alreadySigned: false });

    expect(execute).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'PARQ_RELEASED_BY_HUMAN',
        entityType: 'anamnesis_session',
        entityId: SESSION_ID,
        changes: expect.objectContaining({
          viaProtocolSignature: true,
          protocolId: RESOURCE_ID,
          previousState: 'BLOQUEADO_AGUARDANDO_CLEARANCE',
          newState: 'LIBERADO_COM_RESSALVA_RT',
          actorRole: 'ADMIN',
        }),
      }),
    );
  });

  it('assinatura de protocolo comum: chama a funcao, mas nao audita liberacao de PAR-Q', async () => {
    const { service, append, execute } = makeSequencedService([[pendingProtocol]]);
    // Sem sessão bloqueada, a função é um no-op e devolve NULL.
    (execute as ReturnType<typeof vi.fn>).mockResolvedValue([{ user_id: null }]);

    await service.signProtocol(admin, RESOURCE_ID, { confirmation: true });

    expect(execute).toHaveBeenCalledOnce();
    const actions = append.mock.calls.map((call) => call[1].action);
    expect(actions).toContain('PROTOCOL_SIGNED');
    expect(actions).not.toContain('PARQ_RELEASED_BY_HUMAN');
  });

  /**
   * Vale para QUALQUER assinatura, não só as de PAR-Q: assinar cria documento novo a
   * partir de dado de saúde e dispara entrega — sem base legal, o ato inteiro cai.
   */
  it('consentimento de saude revogado bloqueia a assinatura antes de qualquer escrita', async () => {
    const { service, updateWhere, insertValues, append, execute } = makeSequencedService(
      [[pendingProtocol]],
      'PASS',
      [],
      false,
    );
    const promise = service.signProtocol(admin, RESOURCE_ID, { confirmation: true });
    await expect(promise).rejects.toBeInstanceOf(BadRequestException);
    const error = (await promise.catch((caught: unknown) => caught)) as BadRequestException;
    expect(error.getResponse()).toMatchObject({ code: 'HEALTH_CONSENT_REVOKED' });
    expect(updateWhere).not.toHaveBeenCalled();
    expect(insertValues).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('resolve handoff uma vez e trata retry como idempotente', async () => {
    const fresh = makeSequencedService([[{ userId: USER_ID, status: 'OPEN' }]]);
    await expect(
      fresh.service.resolveHandoff(actor, RESOURCE_ID, {
        resolution: 'ENCAMINHADO',
        notes: 'usuario orientado pelo RT',
        confirmation: true,
      }),
    ).resolves.toEqual({ id: RESOURCE_ID, status: 'RESOLVED' });
    expect(fresh.updateWhere).toHaveBeenCalledOnce();
    expect(fresh.append).toHaveBeenCalledOnce();

    const retry = makeSequencedService([[{ userId: USER_ID, status: 'RESOLVED' }]]);
    await expect(
      retry.service.resolveHandoff(actor, RESOURCE_ID, {
        resolution: 'ENCAMINHADO',
        notes: 'usuario orientado pelo RT',
        confirmation: true,
      }),
    ).resolves.toEqual({ id: RESOURCE_ID, status: 'RESOLVED' });
    expect(retry.append).not.toHaveBeenCalled();
  });

  it('rejeita handoff ausente e payload invalido na borda', async () => {
    const { service } = makeSequencedService([[]]);
    await expect(
      service.resolveHandoff(actor, RESOURCE_ID, {
        resolution: 'x',
        notes: 'y',
        confirmation: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.resolveHandoff(actor, RESOURCE_ID, {
        resolution: 'ENCAMINHADO',
        notes: 'registro valido',
        confirmation: true,
      }),
    ).rejects.toThrow('Handoff nao encontrado.');
  });
});

describe('DashboardService leituras operacionais', () => {
  it('libera leituras globais ao ADMIN (fila, operações, eventos)', async () => {
    const { service } = makeSequencedService([]);
    await expect(service.queue(admin)).resolves.toMatchObject({ mandatory: [], optional: [] });
    await expect(service.operations(admin)).resolves.toMatchObject({ replays: [] });
    expect(() => service.events(admin)).not.toThrow();
  });

  /**
   * Achado 2026-08-22, decisão do fundador: ADMIN (conta fundador) ganhou acesso total
   * às mesmas ações de PROFESSIONAL na fila, incluindo assinar protocolo — a MOVIVO no
   * início só tem um profissional CREF, também sócio-fundador, com conta ADMIN. Um
   * papel qualquer fora desses dois continua barrado (não regrediu).
   */
  it('papel fora de PROFESSIONAL/ADMIN continua barrado das ações que mutam protocolo/handoff', async () => {
    const outsider: AuthenticatedUser = { userId: ACTOR_ID, role: 'SUPPORT', jti: 'jti' };
    const { service } = makeSequencedService([]);
    await expect(
      service.editProtocol(outsider, RESOURCE_ID, { content, reason: 'tentativa indevida' }),
    ).rejects.toThrow('Acesso exclusivo ao profissional CREF');
    await expect(
      service.signProtocol(outsider, RESOURCE_ID, { confirmation: true }),
    ).rejects.toThrow('Acesso exclusivo ao profissional CREF');
    await expect(
      service.resolveHandoff(outsider, RESOURCE_ID, {
        resolution: 'ENCAMINHADO',
        notes: 'decisão técnica registrada',
        confirmation: true,
      }),
    ).rejects.toThrow('Acesso exclusivo ao profissional CREF');
  });

  /**
   * 2026-08-24: a fila é 100% protocolo. O item separado `kind: 'PARQ'` (uma sessão sem
   * protocolo) sumiu; PAR-Q bloqueado agora é um protocolo `MANDATORY` cuja sessão de
   * origem está `BLOQUEADO_AGUARDANDO_CLEARANCE` — sinalizado por `origin: 'PARQ'` e
   * `severity: 'SAFETY'`, para o front distinguir de um `MANDATORY` de edição manual.
   */
  it('mandatory separa PAR-Q (SAFETY) de edição (ALERT); optional é OPTIONAL com prazo', async () => {
    const oldest = new Date('2026-08-01T12:00:00.000Z');
    const middle = new Date('2026-08-02T12:00:00.000Z');
    const newest = new Date('2026-08-03T12:00:00.000Z');
    const { service } = makeSequencedService([
      [
        {
          id: RESOURCE_ID,
          createdAt: newest,
          status: 'PENDING_SIGNATURE',
          name: 'Maria Teste',
          reviewUrgency: 'MANDATORY',
          parqState: null,
        },
        {
          id: '44444444-4444-4444-8444-444444444444',
          createdAt: middle,
          status: 'PENDING_SIGNATURE',
          name: 'Bruno Teste',
          reviewUrgency: 'OPTIONAL',
          parqState: 'LIBERADO',
        },
        {
          id: '55555555-5555-4555-8555-555555555555',
          createdAt: oldest,
          status: 'PENDING_SIGNATURE',
          name: 'Carla Teste',
          reviewUrgency: 'MANDATORY',
          parqState: 'BLOQUEADO_AGUARDANDO_CLEARANCE',
        },
      ],
    ]);
    const result = await service.queue(actor);
    expect(result.counts).toEqual({ mandatory: 2, optional: 1, total: 3 });
    // Ambos são PROTOCOL agora, ordenados por idade (mais antigo primeiro).
    expect(
      result.mandatory.map((item) => ({
        kind: item.kind,
        title: item.title,
        severity: item.severity,
        origin: item.origin,
      })),
    ).toEqual([
      {
        kind: 'PROTOCOL',
        title: 'Protocolo para Revisão: Carla Teste',
        severity: 'SAFETY',
        origin: 'PARQ',
      },
      {
        kind: 'PROTOCOL',
        title: 'Protocolo para Revisão: Maria Teste',
        severity: 'ALERT',
        origin: 'EDIT',
      },
    ]);
    // MANDATORY nunca carrega prazo: não existe job de auto-liberação agendado pra ele.
    expect(result.mandatory.every((item) => item.autoReleaseAt === null)).toBe(true);
    // optional: sem `origin` (não há motivo a exibir) e sempre com prazo.
    expect(result.optional.map((item) => item.title)).toEqual([
      'Protocolo para Revisão: Bruno Teste',
    ]);
    expect(result.optional[0]?.origin).toBeNull();
    expect(result.optional[0]?.severity).toBe('ROUTINE');
    expect(result.optional[0]?.autoReleaseAt).toBe('2026-08-02T13:00:00.000Z');
  });

  it('protocolo anterior à migração 0035 (sem sessão vinculada) segue na fila como EDIT', async () => {
    const { service } = makeSequencedService([
      [
        {
          id: RESOURCE_ID,
          createdAt: new Date('2026-08-01T12:00:00.000Z'),
          status: 'PENDING_SIGNATURE',
          name: 'Legado Teste',
          reviewUrgency: 'MANDATORY',
          // LEFT JOIN sem par → `null`, e não uma linha some da fila.
          parqState: null,
        },
      ],
    ]);
    const result = await service.queue(actor);
    expect(result.counts).toMatchObject({ mandatory: 1 });
    expect(result.mandatory[0]).toMatchObject({ origin: 'EDIT', severity: 'ALERT' });
  });

  it('calcula funil/SLA, primeiro treino e replays anonimizados', async () => {
    const conversationAt = new Date('2026-08-03T12:00:00.000Z');
    const { service, append } = makeSequencedService(
      [
        [{ formStarted: 4, protocolSent: 3, converted: 2 }],
        [{ coachP95Ms: 35_000 }],
        [{ protocolAverageMinutes: 121 }],
        [
          {
            id: 'c1',
            userId: USER_ID,
            direction: 'INBOUND',
            content: 'Meu email e pessoa@example.com',
            createdAt: conversationAt,
            name: 'Pessoa',
            phoneNumber: '+5511999999999',
            email: 'pessoa@example.com',
          },
          {
            id: 'c2',
            userId: USER_ID,
            direction: 'OUTBOUND',
            content: 'Resposta segura',
            createdAt: new Date(conversationAt.getTime() + 1_000),
            name: 'Pessoa',
            phoneNumber: '+5511999999999',
            email: 'pessoa@example.com',
          },
        ],
        [
          { userId: USER_ID, responsesCipher: Buffer.from('one') },
          { userId: USER_ID, responsesCipher: Buffer.from('duplicate') },
          { userId: ACTOR_ID, responsesCipher: Buffer.from('none') },
          { userId: 'x', responsesCipher: null },
        ],
      ],
      'PASS',
      [
        JSON.stringify({ workouts: 'UM_DOIS' }),
        JSON.stringify({ workouts: 'TRES_MAIS' }),
        JSON.stringify({ workouts: 'NENHUM' }),
      ],
    );
    const result = await service.operations(actor);
    expect(result.funnel).toEqual({
      formStarted: 4,
      protocolSent: 3,
      converted: 2,
      firstWorkout: 1,
    });
    expect(result.sla).toEqual({
      protocolDeliveryMinutes: 121,
      coachP95Seconds: 35,
      protocolBreached: true,
      coachBreached: true,
    });
    expect(result.replays[0]?.messages).toHaveLength(2);
    expect(result.replays[0]?.messages[0]?.content).not.toContain('pessoa@example.com');
    expect(append).toHaveBeenCalledTimes(3);
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'HEALTH_DATA_VIEWED',
        userId: USER_ID,
        entityType: 'operations_dashboard',
      }),
    );
  });

  it('preserva SLA indisponivel quando nao existe amostra numerica', async () => {
    const { service } = makeSequencedService([
      [{ formStarted: 0, protocolSent: 0, converted: 0 }],
      [{ coachP95Ms: null }],
      [{ protocolAverageMinutes: 'invalido' }],
      [],
      [],
    ]);
    const result = await service.operations(actor);
    expect(result.sla).toEqual({
      protocolDeliveryMinutes: null,
      coachP95Seconds: null,
      protocolBreached: false,
      coachBreached: false,
    });
  });

  it('retorna detalhes de protocolo e registra leitura sensivel', async () => {
    const { service, append } = makeSequencedService([
      [pendingProtocol],
      [{ name: 'Maria Teste' }],
    ]);
    await expect(service.detail(actor, 'PROTOCOL', RESOURCE_ID)).resolves.toMatchObject({
      item: { kind: 'PROTOCOL', title: 'Protocolo para Revisão: Maria Teste' },
      protocol: {
        id: RESOURCE_ID,
        approvalStatus: 'PENDING_REVIEW',
        totalWeeks: 12,
        createdAt: '2026-08-01T12:00:00.000Z',
      },
    });
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'HEALTH_DATA_VIEWED' }),
    );
  });

  it('anamnesisAnswers: devolve os 3 blocos e registra leitura sensivel', async () => {
    const validPersonal = {
      name: 'Maria Teste',
      birthDate: '1990-01-01',
      biologicalSex: 'FEMALE',
      heightCm: 165,
      weightKg: 60,
      phoneNumber: '+5511999999999',
    };
    const validRoutine = {
      primaryGoal: 'GAIN_MUSCLE',
      trainingStatus: 'NEVER',
      experience: 'BEGINNER',
      daysPerWeek: 3,
      sessionDuration: 'M45_TO_60',
      location: 'HOME',
      preferredPeriod: 'MORNING',
    };
    const { service, append, decryptHealth } = makeSequencedService(
      [
        [pendingProtocol],
        [
          {
            id: 'session-1',
            dataBlock1: validPersonal,
            dataBlock2: Buffer.from('cipher'),
            dataBlock3: validRoutine,
            submittedAt: new Date('2026-08-01T13:00:00.000Z'),
          },
        ],
      ],
      'PASS',
      [
        JSON.stringify({
          parq: {
            version: 'parq-2026-07-v1',
            answers: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'].map((questionId) => ({
              questionId,
              answer: false,
            })),
          },
        }),
      ],
    );

    const result = await service.anamnesisAnswers(actor, RESOURCE_ID);

    expect(result.userId).toBe(USER_ID);
    expect(result.personal).toMatchObject({ name: 'Maria Teste' });
    expect(result.routine).toMatchObject({ primaryGoal: 'GAIN_MUSCLE' });
    expect(result.health).toMatchObject({ parq: { version: 'parq-2026-07-v1' } });
    expect(result.health.parq?.answers).toHaveLength(9);
    expect(decryptHealth).toHaveBeenCalledWith(Buffer.from('cipher'));
    expect(append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'HEALTH_DATA_VIEWED', userId: USER_ID }),
    );
  });

  it('anamnesisAnswers: sem bloco de saude cifrado, health vazio sem chamar decryptHealth', async () => {
    const { service, decryptHealth } = makeSequencedService([
      [pendingProtocol],
      [
        {
          id: 'session-1',
          dataBlock1: {
            name: 'Maria Teste',
            birthDate: '1990-01-01',
            biologicalSex: 'FEMALE',
            heightCm: 165,
            weightKg: 60,
            phoneNumber: '+5511999999999',
          },
          dataBlock2: null,
          dataBlock3: {
            primaryGoal: 'GAIN_MUSCLE',
            trainingStatus: 'NEVER',
            experience: 'BEGINNER',
            daysPerWeek: 3,
            sessionDuration: 'M45_TO_60',
            location: 'HOME',
            preferredPeriod: 'MORNING',
          },
          submittedAt: new Date('2026-08-01T13:00:00.000Z'),
        },
      ],
    ]);
    const result = await service.anamnesisAnswers(actor, RESOURCE_ID);
    expect(result.health).toEqual({});
    expect(decryptHealth).not.toHaveBeenCalled();
  });

  it('anamnesisAnswers: protocolo inexistente lanca 404, sem consultar anamnese', async () => {
    const { service } = makeSequencedService([[]]);
    await expect(service.anamnesisAnswers(actor, RESOURCE_ID)).rejects.toThrow(
      'Protocolo nao encontrado.',
    );
  });

  it('anamnesisAnswers: protocolo existe mas sem sessao de anamnese submetida lanca 404', async () => {
    const { service } = makeSequencedService([[pendingProtocol], []]);
    await expect(service.anamnesisAnswers(actor, RESOURCE_ID)).rejects.toThrow(
      'Anamnese do titular nao encontrada.',
    );
  });

  // `kind: 'PARQ'` deixou de existir (2026-08-24): não há mais tela nem detalhe de PAR-Q.
  it('kind PARQ deixou de ser aceito na rota de detalhe', async () => {
    const { service } = makeSequencedService([]);
    await expect(service.detail(actor, 'PARQ', RESOURCE_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('entrega detalhe de check-in cifrado e handoff conversacional', async () => {
    const createdAt = new Date('2026-08-01T12:00:00.000Z');
    const checkin = makeSequencedService(
      [
        [
          {
            userId: USER_ID,
            checkinId: '66666666-6666-4666-8666-666666666666',
            level: 'SAFETY',
            reason: 'CHECKIN_DOR_ARTICULAR',
            status: 'OPEN',
            createdAt,
          },
        ],
        [{ responsesCipher: Buffer.from('x'), weekNumber: 2, completedAt: null }],
      ],
      'PASS',
      [JSON.stringify({ painReport: 'dor' })],
    );
    await expect(checkin.service.detail(actor, 'CHECKIN', RESOURCE_ID)).resolves.toMatchObject({
      item: { severity: 'SAFETY' },
      context: { weekNumber: 2 },
    });

    const handoff = makeSequencedService([
      [
        {
          userId: USER_ID,
          level: 'ALERT',
          reason: 'ESCOPO',
          conversationId: 'c1',
          status: 'OPEN',
          createdAt,
        },
      ],
      [{ name: null, phoneNumber: '+5511000000000', email: null }],
      [
        {
          id: 'c1',
          direction: 'INBOUND',
          content: 'mensagem',
          createdAt,
        },
      ],
    ]);
    await expect(handoff.service.detail(actor, 'HANDOFF', RESOURCE_ID)).resolves.toMatchObject({
      item: { kind: 'HANDOFF' },
      context: { messages: 1 },
      replay: { messages: [{ role: 'USER' }] },
    });
  });

  it('rejeita kind/id invalidos e recurso inexistente', async () => {
    const { service } = makeSequencedService([[]]);
    await expect(service.detail(actor, 'INVALID', RESOURCE_ID)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.detail(actor, 'PROTOCOL', 'not-a-uuid')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.detail(actor, 'PROTOCOL', RESOURCE_ID)).rejects.toThrow(
      'Protocolo nao encontrado.',
    );
  });
});

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { describe, expect, it, vi } from 'vitest';

import { HealthCipherService } from '../../core/database/health-cipher.service';
import { HealthConsentService } from '../../core/database/health-consent.service';
import { TenantDatabase } from '../../core/database/tenant-database.service';
import { DashboardQueueEventsService } from '../../core/event-bus/dashboard-queue-events.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import { QueueManager } from '../jobs/queue-manager.service';
import type { ExerciseCatalogProvider } from '../protocol/exercise-catalog-provider.service';
import type { ProtocolSubstitutionRepository } from '../protocol/protocol-substitution.repository';
import { ValidationService } from '../protocol/validation/validation.service';
import type { WorkoutPresentationService } from '../protocol/workout-presentation.service';
import { AuditService } from './audit.service';
import { DashboardService } from './dashboard.service';
import type { ExerciseCatalogAdminService } from './exercise-catalog-admin.service';

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
  phaseDurationWeeks: 3,
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
  const update = vi.fn(() => ({ set: () => ({ where: async () => undefined }) }));
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
  const logger = {
    setContext: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  } as unknown as PinoLogger;
  const substitutionRepo = {
    loadActiveProtocol: vi.fn(),
    hasPending: vi.fn(),
    createPending: vi.fn(),
    createCatalogGapPending: vi.fn(),
    release: vi.fn(),
    attachCatalogExerciseAndRelease: vi.fn(),
    discard: vi.fn(),
    findById: vi.fn(),
  } as unknown as ProtocolSubstitutionRepository;
  const workoutPresentation = {
    present: vi.fn(async () => undefined),
  } as unknown as WorkoutPresentationService;
  const exerciseCatalogAdmin = {
    publish: vi.fn(async () => ({ data: { versions: [], totalPublished: 0 }, meta: {} })),
  } as unknown as ExerciseCatalogAdminService;
  const exerciseCatalog = { getById: vi.fn() } as unknown as ExerciseCatalogProvider;
  const service = new DashboardService(
    db,
    validation,
    {} as HealthCipherService,
    audit,
    queues,
    { emit: vi.fn(), stream: vi.fn() } as unknown as DashboardQueueEventsService,
    consentService(),
    substitutionRepo,
    workoutPresentation,
    exerciseCatalogAdmin,
    exerciseCatalog,
    logger,
  );
  return {
    service,
    enqueue,
    append,
    update,
    insert,
    execute,
    substitutionRepo,
    workoutPresentation,
    exerciseCatalogAdmin,
    exerciseCatalog,
  };
}

function makeSequencedService(
  selections: unknown[][],
  verdict: 'PASS' | 'FLAG_HUMAN_REVIEW' = 'PASS',
  decrypted: string[] = [],
  consentActive = true,
) {
  // Casca de `update(...).set(...).where(...)`: thenable (array vazio) + `.returning()` —
  // `supersedePreviousActiveProtocols` (ADR-008) encadeia `.returning()` na mesma chamada.
  const updateWhere = vi.fn(() =>
    Object.assign(Promise.resolve([]), { returning: vi.fn(async () => []) }),
  );
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
  const substitutionRepo = {
    loadActiveProtocol: vi.fn(),
    hasPending: vi.fn(),
    createPending: vi.fn(),
    release: vi.fn(),
    discard: vi.fn(),
    findById: vi.fn(),
  } as unknown as ProtocolSubstitutionRepository;
  const workoutPresentation = {
    present: vi.fn(async () => undefined),
  } as unknown as WorkoutPresentationService;
  const exerciseCatalogAdmin = {
    publish: vi.fn(async () => ({ data: { versions: [], totalPublished: 0 }, meta: {} })),
  } as unknown as ExerciseCatalogAdminService;
  const exerciseCatalog = { getById: vi.fn() } as unknown as ExerciseCatalogProvider;
  const service = new DashboardService(
    db,
    validation,
    { decryptHealth } as unknown as HealthCipherService,
    { append } as unknown as AuditService,
    { enqueue } as unknown as QueueManager,
    { emit, stream: vi.fn() } as unknown as DashboardQueueEventsService,
    consentService(consentActive),
    substitutionRepo,
    workoutPresentation,
    exerciseCatalogAdmin,
    exerciseCatalog,
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
    substitutionRepo,
    workoutPresentation,
    exerciseCatalogAdmin,
    exerciseCatalog,
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
    // 2 updates em `protocols`: ativa este protocolo + supersede o mesociclo anterior
    // ACTIVE do mesmo titular (`supersedePreviousActiveProtocols`, no-op aqui pois o mock
    // não tem outra linha ACTIVE, mas a chamada acontece sempre na mesma transação).
    expect(updateWhere).toHaveBeenCalledTimes(2);
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
    expect(updateWhere).toHaveBeenCalledTimes(2);
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

  // Achado 2026-09-02 — fluxo de substituição de exercício via IA: aprovação/recusa manual
  // do profissional reusam `ProtocolSubstitutionRepository.release()`/`.discard()` (o mesmo
  // caminho de aplicação do worker de liberação automática), nunca reimplementam a mecânica.
  describe('substituição de exercício via IA — aprovação/recusa manual', () => {
    it('aprova antes da janela de 30 min: aplica, entrega e emite o evento da fila', async () => {
      const { service, enqueue, substitutionRepo } = makeService(pendingProtocol);
      vi.mocked(substitutionRepo.release).mockResolvedValue({
        released: true,
        protocolId: RESOURCE_ID,
        userId: USER_ID,
        version: 4,
        content,
        mesocycleName: 'Mesociclo 1',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-02-01'),
        totalWeeks: 4,
      } as never);

      const result = await service.approveSubstitutionNow(actor, RESOURCE_ID);
      expect(result).toEqual({
        id: RESOURCE_ID,
        protocolId: RESOURCE_ID,
        version: 4,
        released: true,
      });
      expect(substitutionRepo.release).toHaveBeenCalledWith(
        { userId: ACTOR_ID, role: 'PROFESSIONAL' },
        RESOURCE_ID,
      );
      expect(enqueue).toHaveBeenCalledWith(
        'whatsapp-outbound',
        'protocol-delivery',
        expect.objectContaining({ userId: USER_ID, protocolId: RESOURCE_ID, protocolVersion: 4 }),
        expect.objectContaining({ jobId: `substitution-delivery_manual_${RESOURCE_ID}` }),
      );
    });

    it('proposta já decidida (ou protocolo mudou de versão) → 400, sem entregar nada', async () => {
      const { service, enqueue, substitutionRepo } = makeService(pendingProtocol);
      vi.mocked(substitutionRepo.release).mockResolvedValue({ released: false } as never);

      await expect(service.approveSubstitutionNow(actor, RESOURCE_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('recusa mantém o exercício original (não chama release), audita com o ator e avisa o aluno', async () => {
      const { service, append, enqueue, substitutionRepo } = makeService(pendingProtocol);
      vi.mocked(substitutionRepo.discard).mockResolvedValue({
        discarded: true,
        protocolId: RESOURCE_ID,
        userId: USER_ID,
      } as never);

      const result = await service.discardSubstitution(actor, RESOURCE_ID);
      expect(result).toEqual({ id: RESOURCE_ID, discarded: true });
      expect(substitutionRepo.release).not.toHaveBeenCalled();
      expect(append).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          actorId: ACTOR_ID,
          userId: USER_ID,
          action: 'PROTOCOL_SUBSTITUTION_DISCARDED',
          entityId: RESOURCE_ID,
        }),
      );
      // Achado 2026-09-09 (pedido do fundador): a recusa era silenciosa pro aluno — agora
      // avisa por WhatsApp, mesmo padrão de `coach-message` do `AiResponseWorker`.
      expect(enqueue).toHaveBeenCalledWith(
        'whatsapp-outbound',
        'coach-message',
        expect.objectContaining({
          userId: USER_ID,
          type: 'COACH_MESSAGE',
          text: expect.stringContaining('Revisei a solicitação de substituição'),
        }),
        expect.objectContaining({ jobId: `substitution-discarded_${RESOURCE_ID}` }),
      );
    });

    it('recusa de proposta já decidida → 400, sem auditar nem avisar', async () => {
      const { service, append, enqueue, substitutionRepo } = makeService(pendingProtocol);
      vi.mocked(substitutionRepo.discard).mockResolvedValue({
        discarded: false,
        protocolId: null,
        userId: null,
      } as never);

      await expect(service.discardSubstitution(actor, RESOURCE_ID)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(append).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('papel fora de PROFESSIONAL/ADMIN não aprova nem recusa', async () => {
      const { service } = makeService(pendingProtocol);
      const outsider: AuthenticatedUser = { userId: ACTOR_ID, role: 'SUPPORT', jti: 'jti' };
      await expect(service.approveSubstitutionNow(outsider, RESOURCE_ID)).rejects.toThrow();
      await expect(service.discardSubstitution(outsider, RESOURCE_ID)).rejects.toThrow();
    });
  });

  // Achado 2026-09-09 (pedido do fundador): "Adicionar exercício ao catálogo" — publica o
  // exercício (reaproveita `ExerciseCatalogAdminService.publish`, sem alteração) e SÓ ENTÃO
  // aprova a substituição, reusando a MESMA entrega por WhatsApp de `approveSubstitutionNow`
  // (`deliverReleasedSubstitution`, extraído pra não duplicar).
  describe('substituição catalogGap — adicionar exercício ao catálogo e aprovar', () => {
    const CATALOG_BODY = {
      exerciseKey: 'supino_reto_maquina',
      changeNote: 'Adicionado a partir de pedido de aluno via WhatsApp',
      name: 'Supino Reto (Máquina)',
      pattern: 'HORIZONTAL_PUSH',
      muscleGroups: ['peito'],
      equipment: ['máquina'],
      locations: ['FULL_GYM'],
      minLevel: 'INICIANTE',
      contraindicatedFor: [],
      substitutes: [],
    };

    it('publica o exercício, aplica a troca e entrega o protocolo atualizado', async () => {
      const { service, enqueue, substitutionRepo, exerciseCatalogAdmin, exerciseCatalog } =
        makeService(pendingProtocol);
      const chosen = { id: 'supino_reto_maquina', name: 'Supino Reto (Máquina)' };
      vi.mocked(exerciseCatalog.getById).mockReturnValue(chosen as never);
      vi.mocked(substitutionRepo.attachCatalogExerciseAndRelease).mockResolvedValue({
        released: true,
        protocolId: RESOURCE_ID,
        userId: USER_ID,
        version: 4,
        content,
        mesocycleName: 'Mesociclo 1',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-02-01'),
        totalWeeks: 4,
        fromExerciseName: 'Supino Reto (Barra)',
        toExerciseName: 'Supino Reto (Máquina)',
      } as never);

      const result = await service.addCatalogExerciseAndApproveSubstitution(
        admin,
        RESOURCE_ID,
        CATALOG_BODY,
      );
      expect(result).toEqual({
        id: RESOURCE_ID,
        protocolId: RESOURCE_ID,
        version: 4,
        released: true,
      });
      expect(exerciseCatalogAdmin.publish).toHaveBeenCalledWith(admin, CATALOG_BODY);
      expect(substitutionRepo.attachCatalogExerciseAndRelease).toHaveBeenCalledWith(
        { userId: ACTOR_ID, role: 'ADMIN' },
        RESOURCE_ID,
        chosen,
      );
      expect(enqueue).toHaveBeenCalledWith(
        'whatsapp-outbound',
        'protocol-delivery',
        expect.objectContaining({ userId: USER_ID, protocolId: RESOURCE_ID, protocolVersion: 4 }),
        expect.anything(),
      );
    });

    it('exercício recém-publicado quebra a validação do protocolo inteiro → 400 com as violações, sem entregar', async () => {
      const { service, enqueue, substitutionRepo, exerciseCatalog } = makeService(pendingProtocol);
      vi.mocked(exerciseCatalog.getById).mockReturnValue({
        id: 'supino_reto_maquina',
        name: 'Supino Reto (Máquina)',
      } as never);
      vi.mocked(substitutionRepo.attachCatalogExerciseAndRelease).mockResolvedValue({
        released: false,
        reason: 'VALIDATION_FAILED',
        violations: ['EXERCISE_LEVEL_TOO_HIGH'],
      } as never);

      await expect(
        service.addCatalogExerciseAndApproveSubstitution(admin, RESOURCE_ID, CATALOG_BODY),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'VALIDATION_FAILED' }),
      });
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('proposta já decidida ou protocolo mudou de versão → 400, sem entregar', async () => {
      const { service, enqueue, substitutionRepo, exerciseCatalog } = makeService(pendingProtocol);
      vi.mocked(exerciseCatalog.getById).mockReturnValue({
        id: 'supino_reto_maquina',
        name: 'Supino Reto (Máquina)',
      } as never);
      vi.mocked(substitutionRepo.attachCatalogExerciseAndRelease).mockResolvedValue({
        released: false,
        reason: 'STALE',
      } as never);

      await expect(
        service.addCatalogExerciseAndApproveSubstitution(admin, RESOURCE_ID, CATALOG_BODY),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('papel fora de PROFESSIONAL/ADMIN não adiciona nem aprova', async () => {
      const { service } = makeService(pendingProtocol);
      const outsider: AuthenticatedUser = { userId: ACTOR_ID, role: 'SUPPORT', jti: 'jti' };
      await expect(
        service.addCatalogExerciseAndApproveSubstitution(outsider, RESOURCE_ID, CATALOG_BODY),
      ).rejects.toThrow();
    });

    // Achado 2026-09-09: `PROFESSIONAL` passa no guard de PAPEL (`@Roles`), mas não tem
    // `AI_CONFIG_WRITE` (`CAPABILITIES_BY_ROLE`, @movivo/shared) — só aprova conteúdo
    // curado (conhecimento/metodologia/guardrail), nunca publica exercício novo livremente.
    // Sem este guard explícito, o service-to-service pra `ExerciseCatalogAdminService`
    // (fora do `@RequireCapabilities` do controller de catálogo) furaria esse limite.
    it('PROFESSIONAL tem papel válido mas não tem AI_CONFIG_WRITE → 403, sem publicar nem tocar a proposta', async () => {
      const { service, exerciseCatalogAdmin, substitutionRepo } = makeService(pendingProtocol);
      await expect(
        service.addCatalogExerciseAndApproveSubstitution(actor, RESOURCE_ID, CATALOG_BODY),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(exerciseCatalogAdmin.publish).not.toHaveBeenCalled();
      expect(substitutionRepo.attachCatalogExerciseAndRelease).not.toHaveBeenCalled();
    });
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
    expect(result.counts).toEqual({
      mandatory: 2,
      optional: 1,
      substitutionMandatory: 0,
      substitutionOptional: 0,
      total: 3,
    });
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

  // Achado 2026-09-02, ampliado 2026-09-03 (a pedido do fundador): proposta de
  // substituição de exercício via IA entra na fila como `SUBSTITUTION`, em
  // `substitutionOptional` quando o protocolo de origem NÃO veio de PAR-Q bloqueante —
  // continua sempre auto-liberando.
  it('proposta de substituição via IA sem origem em PAR-Q bloqueante entra em substitutionOptional', async () => {
    const createdAt = new Date('2026-09-01T10:00:00.000Z');
    const { service } = makeSequencedService([
      [], // protocolos pendentes: nenhum
      [
        {
          id: RESOURCE_ID,
          createdAt,
          status: 'PENDING',
          name: 'Ana Teste',
          parqState: 'LIBERADO',
        },
      ],
    ]);
    const result = await service.queue(actor);
    expect(result.counts).toEqual({
      mandatory: 0,
      optional: 0,
      substitutionMandatory: 0,
      substitutionOptional: 1,
      total: 1,
    });
    expect(result.substitutionOptional[0]).toMatchObject({
      id: RESOURCE_ID,
      kind: 'SUBSTITUTION',
      severity: 'ROUTINE',
      title: 'Substituição de Exercício: Ana Teste',
      origin: 'AI_SUBSTITUTION',
      autoReleaseAt: '2026-09-01T10:30:00.000Z',
    });
  });

  // Achado 2026-09-03 (a pedido do fundador): aluno cujo protocolo ATIVO veio de PAR-Q
  // bloqueante — a substituição entra em `substitutionMandatory`, `severity: SAFETY`,
  // SEM prazo de auto-liberação (mesma regra de "nenhum sai sozinho" do protocolo
  // MANDATORY — o job nem chega a ser agendado, ver `AiResponseWorker`).
  it('proposta de substituição com origem em PAR-Q bloqueante entra em substitutionMandatory, sem auto-liberação', async () => {
    const createdAt = new Date('2026-09-01T10:00:00.000Z');
    const { service } = makeSequencedService([
      [], // protocolos pendentes: nenhum
      [
        {
          id: RESOURCE_ID,
          createdAt,
          status: 'PENDING',
          name: 'Carla Teste',
          parqState: 'BLOQUEADO_AGUARDANDO_CLEARANCE',
        },
      ],
    ]);
    const result = await service.queue(actor);
    expect(result.counts).toEqual({
      mandatory: 0,
      optional: 0,
      substitutionMandatory: 1,
      substitutionOptional: 0,
      total: 1,
    });
    expect(result.substitutionMandatory[0]).toMatchObject({
      id: RESOURCE_ID,
      kind: 'SUBSTITUTION',
      severity: 'SAFETY',
      title: 'Substituição de Exercício: Carla Teste',
      origin: 'AI_SUBSTITUTION',
      autoReleaseAt: null,
    });
  });

  // Achado 2026-09-09 (pedido do fundador): exercício pedido existe no catálogo mas não é
  // elegível — `reviewUrgency: MANDATORY` nasce já decidido na criação da proposta (não
  // depende do PAR-Q), mesma regra de "nenhum sai sozinho": `severity: ALERT` (não SAFETY,
  // que é reservado pro alerta clínico de PAR-Q), sem `autoReleaseAt`.
  it('proposta com reviewUrgency MANDATORY (exercício não elegível) entra em substitutionMandatory, severity ALERT', async () => {
    const createdAt = new Date('2026-09-01T10:00:00.000Z');
    const { service } = makeSequencedService([
      [],
      [
        {
          id: RESOURCE_ID,
          createdAt,
          status: 'PENDING',
          name: 'Rodrigo Teste',
          parqState: 'LIBERADO',
          reviewUrgency: 'MANDATORY',
          catalogGap: false,
        },
      ],
    ]);
    const result = await service.queue(actor);
    expect(result.counts).toMatchObject({ substitutionMandatory: 1, substitutionOptional: 0 });
    expect(result.substitutionMandatory[0]).toMatchObject({
      severity: 'ALERT',
      origin: 'AI_SUBSTITUTION',
      autoReleaseAt: null,
    });
  });

  // Achado 2026-09-09: exercício pedido NÃO existe em lugar nenhum do catálogo —
  // `catalogGap: true` muda só o `origin` (liga a opção "adicionar ao catálogo" na tela),
  // continua `reviewUrgency: MANDATORY`/`substitutionMandatory`.
  it('proposta catalogGap entra em substitutionMandatory com origin CATALOG_GAP', async () => {
    const createdAt = new Date('2026-09-01T10:00:00.000Z');
    const { service } = makeSequencedService([
      [],
      [
        {
          id: RESOURCE_ID,
          createdAt,
          status: 'PENDING',
          name: 'Rodrigo Teste',
          parqState: 'LIBERADO',
          reviewUrgency: 'MANDATORY',
          catalogGap: true,
        },
      ],
    ]);
    const result = await service.queue(actor);
    expect(result.substitutionMandatory[0]).toMatchObject({
      severity: 'ALERT',
      origin: 'CATALOG_GAP',
      autoReleaseAt: null,
    });
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

  // Achado 2026-09-03 (a pedido do fundador): protocolo que caiu no template de fallback
  // é MANDATORY mesmo com PAR-Q liberado, e a fila precisa distinguir isso de EDIT — ver
  // `ProtocolGenerationWorker`/`protocol-planner.ts`.
  it('protocolo gerado pelo template de fallback entra como MANDATORY/FALLBACK, mesmo com PAR-Q liberado', async () => {
    const { service } = makeSequencedService([
      [
        {
          id: RESOURCE_ID,
          createdAt: new Date('2026-09-03T12:00:00.000Z'),
          status: 'PENDING_SIGNATURE',
          name: 'Fallback Teste',
          reviewUrgency: 'MANDATORY',
          generatedBy: 'FALLBACK_TEMPLATE',
          parqState: 'LIBERADO',
        },
      ],
    ]);
    const result = await service.queue(actor);
    expect(result.counts).toMatchObject({ mandatory: 1 });
    expect(result.mandatory[0]).toMatchObject({ origin: 'FALLBACK', severity: 'ALERT' });
    expect(result.mandatory[0]?.autoReleaseAt).toBeNull();
  });

  it('calcula funil/SLA, primeiro treino e replays com o conteúdo real da conversa', async () => {
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
            studentName: 'Pessoa',
          },
          {
            id: 'c2',
            userId: USER_ID,
            direction: 'OUTBOUND',
            content: 'Resposta segura',
            createdAt: new Date(conversationAt.getTime() + 1_000),
            studentName: 'Pessoa',
          },
        ],
        [
          { userId: USER_ID, answers: { adherenceScore: 4 } },
          { userId: USER_ID, answers: { adherenceScore: 8 } },
          { userId: ACTOR_ID, answers: { adherenceScore: 0 } },
          { userId: 'x', answers: null },
        ],
      ],
      'PASS',
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
    // Achado 2026-09-08 (pedido do fundador): nome real do titular, não "Pessoa usuária".
    expect(result.replays[0]?.studentName).toBe('Pessoa');
    // Achado 2026-09-08 (decisão do fundador): painel de uso interno da MOVIVO, sem
    // anonimização do conteúdo da conversa.
    expect(result.replays[0]?.messages[0]?.content).toBe('Meu email e pessoa@example.com');
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
      email: 'maria@example.com',
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
            email: 'maria@example.com',
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
        [
          {
            answers: { sleepQuality: 'BOA' },
            notesCipher: Buffer.from('x'),
            weekNumber: 2,
            submittedAt: null,
          },
        ],
      ],
      'PASS',
      [JSON.stringify({ difficultExerciseDescription: 'dor' })],
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
      [{ name: 'Pessoa Teste' }],
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
      replay: { studentName: 'Pessoa Teste', messages: [{ role: 'USER' }] },
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

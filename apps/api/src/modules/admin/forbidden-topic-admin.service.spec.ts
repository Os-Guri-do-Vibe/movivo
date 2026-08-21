import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { ForbiddenTopicsService } from '../../core/agent-config/forbidden-topics.service';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import type { AuditService } from './audit.service';
import * as configSimulator from './config-simulator';
import { ForbiddenTopicAdminService } from './forbidden-topic-admin.service';

vi.mock('./config-simulator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./config-simulator')>();
  return { ...actual, simulateForbiddenTopicConfig: vi.fn() };
});

const ACTOR = {
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'ADMIN',
  jti: 'j1',
} as const as AuthenticatedUser;

const OTHER_MAKER = '44444444-4444-4444-8444-444444444444';
const TOPIC_KEY = 'suplementos-anabolizantes';
const NEW_ROW_ID = '33333333-3333-4333-8333-333333333333';

const VALID_BODY = {
  topicKey: TOPIC_KEY,
  label: 'Suplementos e Anabolizantes',
  phrases: ['anabolizante', 'esteroide anabolico'],
  changeNote: 'Proposta inicial revisada com o time jurídico',
};

/** Linha mínima que `current()` devolve — precisa satisfazer `forbiddenTopicCandidateSchema`. */
function currentRow(overrides: Record<string, unknown> = {}) {
  return {
    topicKey: TOPIC_KEY,
    label: 'Suplementos e Anabolizantes',
    phrases: ['anabolizante', 'esteroide anabolico'],
    status: 'DRAFT',
    createdBy: OTHER_MAKER,
    ...overrides,
  };
}

/**
 * `select`/`insert`/`execute` são filas independentes: cada chamada do serviço a um deles
 * consome o próximo item na ordem em que o método real dispara a chamada. `select()` cobre
 * tanto `current()` (`.where().orderBy().limit()`) quanto `list()` (`.leftJoin().leftJoin()
 * .orderBy()`) — ambos terminam num `await` direto da cadeia, por isso o mock expõe `then`.
 */
function forbiddenTopicsWith(
  options: {
    executeQueue?: unknown[][];
    selectQueue?: unknown[][];
    insertResult?: { id: string } | null;
    simulationPassed?: boolean;
  } = {},
) {
  const {
    executeQueue = [],
    selectQueue = [[]],
    insertResult = { id: NEW_ROW_ID },
    simulationPassed = true,
  } = options;

  const executeQ = [...executeQueue];
  const execute = vi.fn(async () => executeQ.shift() ?? []);

  const selectQ = [...selectQueue];
  const select = vi.fn(() => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(selectQ.shift() ?? []),
      then: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) =>
        Promise.resolve(selectQ.shift() ?? []).then(resolve, reject),
    };
    return chain;
  });

  const insert = vi.fn(() => ({
    values: () => ({
      returning: () => Promise.resolve(insertResult ? [insertResult] : []),
    }),
  }));

  const tx = { execute, select, insert };
  const db = {
    runAsSystem: vi.fn((callback: (value: unknown) => Promise<unknown>) => callback(tx)),
    runAsUser: vi.fn(
      (_userId: string, _role: string, callback: (value: unknown) => Promise<unknown>) =>
        callback(tx),
    ),
  } as unknown as TenantDatabase;

  const audit = { append: vi.fn().mockResolvedValue(undefined) };
  const runtime = {
    propagate: vi.fn().mockResolvedValue(undefined),
  } as unknown as ForbiddenTopicsService;

  vi.mocked(configSimulator.simulateForbiddenTopicConfig).mockReturnValue(
    simulationPassed
      ? { kind: 'FORBIDDEN_TOPIC', passed: true, candidateHash: 'hash', checks: [] }
      : {
          kind: 'FORBIDDEN_TOPIC',
          passed: false,
          candidateHash: 'hash',
          checks: [
            {
              id: 'GOLDEN_INPUT',
              title: 'Bloqueio sem atingir conversas legítimas',
              passed: false,
              cases: 1,
              failures: ['Bloqueio excessivo: exemplo'],
            },
          ],
        },
  );

  const service = new ForbiddenTopicAdminService(db, runtime, audit as unknown as AuditService);
  return { service, audit, runtime, execute, select, insert, db };
}

describe('ForbiddenTopicAdminService.list', () => {
  it('marca current=true só na versão mais recente de cada chave e filtra ativas aprovadas', async () => {
    const rows = [
      { ...currentRow({ status: 'APPROVED' }), id: 'v2', version: 2, createdAt: new Date() },
      { ...currentRow({ status: 'RETIRED' }), id: 'v1', version: 1, createdAt: new Date() },
    ];
    const { service } = forbiddenTopicsWith({ selectQueue: [rows] });

    const response = await service.list();

    expect(response.data.versions[0]).toMatchObject({ id: 'v2', current: true });
    expect(response.data.versions[1]).toMatchObject({ id: 'v1', current: false });
    expect(response.data.activeLabels).toEqual(['Suplementos e Anabolizantes']);
    expect(response.data.limits.maxActiveTopics).toBeGreaterThan(0);
  });
});

describe('ForbiddenTopicAdminService.propose', () => {
  it('cria a proposta como DRAFT quando o simulador aprova', async () => {
    const { service, audit, runtime } = forbiddenTopicsWith({
      executeQueue: [[]], // lock
      selectQueue: [
        [], // current(): nenhuma proposta anterior para a chave
        [], // nextVersion(): sem versões, começa em 1
        [], // list() final
      ],
    });

    await service.propose(ACTOR, VALID_BODY);

    expect(runtime.propagate).toHaveBeenCalledOnce();
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'forbidden_topic.propose' }),
    );
  });

  it('recusa corpo fora do contrato sem tocar no banco', async () => {
    const { service, execute } = forbiddenTopicsWith();
    await expect(
      service.propose(ACTOR, { ...VALID_BODY, topicKey: 'CHAVE INVALIDA' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(execute).not.toHaveBeenCalled();
  });

  it('recusa quando o simulador reprova (anti-over-blocking)', async () => {
    const { service, execute } = forbiddenTopicsWith({ simulationPassed: false });
    await expect(service.propose(ACTOR, VALID_BODY)).rejects.toBeInstanceOf(BadRequestException);
    expect(execute).not.toHaveBeenCalled();
  });

  it('recusa proposta duplicada enquanto já existe uma ativa para a chave', async () => {
    const { service } = forbiddenTopicsWith({
      executeQueue: [[]],
      selectQueue: [[currentRow({ status: 'PENDING_APPROVAL' })]],
    });
    await expect(service.propose(ACTOR, VALID_BODY)).rejects.toBeInstanceOf(ConflictException);
  });

  it('permite nova proposta quando a última versão da chave está RETIRED', async () => {
    const { service } = forbiddenTopicsWith({
      executeQueue: [[]],
      selectQueue: [[currentRow({ status: 'RETIRED' })], [{ max: 3 }], []],
    });
    await expect(service.propose(ACTOR, VALID_BODY)).resolves.toBeDefined();
  });
});

describe('ForbiddenTopicAdminService.submit', () => {
  const SUBMIT = { topicKey: TOPIC_KEY, note: 'Pronta para revisão CREF' };

  it('DRAFT → PENDING_APPROVAL', async () => {
    const { service, audit } = forbiddenTopicsWith({
      executeQueue: [[]], // lock
      selectQueue: [
        [currentRow({ status: 'DRAFT' })], // requireCurrent
        [], // nextVersion
        [], // list() final
      ],
    });

    await service.submit(ACTOR, SUBMIT);

    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'forbidden_topic.submit' }),
    );
  });

  it('404 quando a chave não existe', async () => {
    const { service } = forbiddenTopicsWith({ executeQueue: [[]], selectQueue: [[]] });
    await expect(service.submit(ACTOR, SUBMIT)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('recusa transição fora de DRAFT', async () => {
    const { service } = forbiddenTopicsWith({
      executeQueue: [[]],
      selectQueue: [[currentRow({ status: 'APPROVED' })]],
    });
    await expect(service.submit(ACTOR, SUBMIT)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ForbiddenTopicAdminService.approve', () => {
  const APPROVE = { topicKey: TOPIC_KEY, note: 'Parecer técnico favorável' };
  const CREF_OK = [{ id: ACTOR.userId }];

  it('aprova quando o revisor CREF é diferente do autor', async () => {
    const { service, audit, runtime } = forbiddenTopicsWith({
      executeQueue: [
        [], // lock
        CREF_OK, // assertActiveCref
        [{ active_count: 0, phrase_count: 0 }], // assertCapacity
      ],
      selectQueue: [
        [currentRow({ status: 'PENDING_APPROVAL', createdBy: OTHER_MAKER })], // requireCurrent
        [], // nextVersion
        [], // list() final
      ],
    });

    await service.approve(ACTOR, APPROVE);

    expect(runtime.propagate).toHaveBeenCalledOnce();
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'forbidden_topic.approve' }),
    );
  });

  it('maker-checker: o autor não pode aprovar o próprio tema', async () => {
    const { service } = forbiddenTopicsWith({
      executeQueue: [[], [{ id: ACTOR.userId }]],
      selectQueue: [[currentRow({ status: 'PENDING_APPROVAL', createdBy: ACTOR.userId })]],
    });
    await expect(service.approve(ACTOR, APPROVE)).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa aprovar sem profissional CREF ativo', async () => {
    const { service } = forbiddenTopicsWith({ executeQueue: [[], []] });
    await expect(service.approve(ACTOR, APPROVE)).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa aprovar quando o tema não está PENDING_APPROVAL', async () => {
    const { service } = forbiddenTopicsWith({
      executeQueue: [[], CREF_OK],
      selectQueue: [[currentRow({ status: 'DRAFT' })]],
    });
    await expect(service.approve(ACTOR, APPROVE)).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa aprovar ao estourar o teto de temas ativos', async () => {
    const { service } = forbiddenTopicsWith({
      executeQueue: [[], CREF_OK, [{ active_count: 12, phrase_count: 0 }]],
      selectQueue: [[currentRow({ status: 'PENDING_APPROVAL', createdBy: OTHER_MAKER })]],
    });
    await expect(service.approve(ACTOR, APPROVE)).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa aprovar ao estourar o teto total de termos', async () => {
    const { service } = forbiddenTopicsWith({
      executeQueue: [[], CREF_OK, [{ active_count: 0, phrase_count: 299 }]],
      selectQueue: [[currentRow({ status: 'PENDING_APPROVAL', createdBy: OTHER_MAKER })]],
    });
    await expect(service.approve(ACTOR, APPROVE)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ForbiddenTopicAdminService.retire', () => {
  const RETIRE = { topicKey: TOPIC_KEY, note: 'Tema não é mais necessário' };
  const CREF_OK = [{ id: ACTOR.userId }];

  it('retira quando o revisor CREF é diferente do autor', async () => {
    const { service, audit, runtime } = forbiddenTopicsWith({
      executeQueue: [[], CREF_OK],
      selectQueue: [[currentRow({ status: 'APPROVED', createdBy: OTHER_MAKER })], [], []],
    });

    await service.retire(ACTOR, RETIRE);

    expect(runtime.propagate).toHaveBeenCalledOnce();
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'forbidden_topic.retire' }),
    );
  });

  it('maker-checker: o autor não pode retirar o próprio tema', async () => {
    const { service } = forbiddenTopicsWith({
      executeQueue: [[], CREF_OK],
      selectQueue: [[currentRow({ status: 'APPROVED', createdBy: ACTOR.userId })]],
    });
    await expect(service.retire(ACTOR, RETIRE)).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa retirar tema que não está APPROVED', async () => {
    const { service } = forbiddenTopicsWith({
      executeQueue: [[], CREF_OK],
      selectQueue: [[currentRow({ status: 'DRAFT' })]],
    });
    await expect(service.retire(ACTOR, RETIRE)).rejects.toBeInstanceOf(ConflictException);
  });

  it('propaga falha de escrita quando o insert não retorna linha', async () => {
    const { service } = forbiddenTopicsWith({
      executeQueue: [[], CREF_OK],
      selectQueue: [[currentRow({ status: 'APPROVED', createdBy: OTHER_MAKER })], []],
      insertResult: null,
    });
    await expect(service.retire(ACTOR, RETIRE)).rejects.toBeInstanceOf(BadRequestException);
  });
});

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { MethodologyProvider } from '../protocol/methodology-provider.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import type { AuditService } from './audit.service';
import { MethodologyAdminService } from './methodology-admin.service';

const ACTOR = {
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'ADMIN',
  jti: 'j1',
} as const as AuthenticatedUser;

const OTHER_CREF = '44444444-4444-4444-8444-444444444444';
const VERSION_ID = '33333333-3333-4333-8333-333333333333';
const CREF_OK = [{ ok: 1 }];

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: VERSION_ID,
    version: 1,
    version_label: 'methodology-v1',
    content: 'Progressão dupla conforme protocolo assinado pelo profissional CREF.',
    content_sha256: 'a'.repeat(64),
    change_note: 'Migração inicial',
    status: 'DRAFT',
    created_by_name: 'Admin',
    last_actor_name: null,
    created_at: new Date('2026-08-13T12:00:00.000Z'),
    status_changed_at: new Date('2026-08-13T12:00:00.000Z'),
    ...overrides,
  };
}

/**
 * `executes` é consumido em ordem por `tx.execute` dentro de uma única invocação de
 * serviço; o item sobressalente repete via `mockImplementation` (fallback `documents`).
 * Métodos que mutam terminam chamando `this.list(actor)`, que soma mais uma chamada de
 * `execute` (a query de listagem) ao final da sequência.
 */
function methodologyWith(
  options: {
    executes?: unknown[][];
    documents?: unknown[];
  } = {},
) {
  const { executes = [], documents = [versionRow()] } = options;
  const execute = vi.fn();
  for (const rows of executes) execute.mockImplementationOnce(async () => rows);
  execute.mockImplementation(async () => documents);
  const tx = { execute };
  const db = {
    runAsUser: vi.fn((_userId: string, _role: string, cb: (value: unknown) => Promise<unknown>) =>
      cb(tx),
    ),
  } as unknown as TenantDatabase;
  const audit = { append: vi.fn().mockResolvedValue(undefined) };
  const provider = {
    ensureBootstrap: vi.fn().mockResolvedValue(undefined),
    invalidate: vi.fn(),
    current: vi.fn(),
  } as unknown as MethodologyProvider;
  const service = new MethodologyAdminService(db, provider, audit as unknown as AuditService);
  return { service, audit, provider, execute, db };
}

describe('MethodologyAdminService.list', () => {
  it('garante o bootstrap, mapeia a versão vigente e audita a leitura', async () => {
    const { service, audit, provider } = methodologyWith({
      executes: [
        [
          versionRow({ status: 'PUBLISHED' }),
          versionRow({
            id: '99999999-9999-4999-8999-999999999999',
            version: 0,
            status: 'ARCHIVED',
          }),
        ],
      ],
    });

    const response = await service.list(ACTOR);

    expect(provider.ensureBootstrap).toHaveBeenCalledOnce();
    expect(response.data.currentVersionId).toBe(VERSION_ID);
    expect(response.data.versions[0]).toMatchObject({
      id: VERSION_ID,
      status: 'PUBLISHED',
      createdBy: 'Admin',
      createdAt: '2026-08-13T12:00:00.000Z',
    });
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'methodology.list' }),
    );
  });

  it('sem versão publicada, currentVersionId é null', async () => {
    const { service } = methodologyWith({ executes: [[versionRow({ status: 'DRAFT' })]] });
    const response = await service.list(ACTOR);
    expect(response.data.currentVersionId).toBeNull();
  });
});

describe('MethodologyAdminService.create', () => {
  const BODY = { content: 'x'.repeat(200), changeNote: 'Mudança auditável e coerente' };

  it('cria a versão como DRAFT com hash do conteúdo', async () => {
    const { service, audit } = methodologyWith({
      executes: [
        [], // advisory lock
        [], // dedupe por content_sha256: nenhuma versão igual
        [{ id: VERSION_ID, version: 2 }], // insert RETURNING
        [], // appendEvent(DRAFT)
        [versionRow({ version: 2, status: 'DRAFT' })], // list() final
      ],
    });

    await service.create(ACTOR, BODY);

    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'methodology.create',
        changes: expect.objectContaining({ version: 2 }),
      }),
    );
  });

  it('recusa corpo fora do contrato sem tocar no banco', async () => {
    const { service, execute } = methodologyWith();
    await expect(service.create(ACTOR, { content: 'curto demais' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('recusa conteúdo duplicado (mesmo sha256) como conflito', async () => {
    const { service } = methodologyWith({
      executes: [[], [{ id: VERSION_ID }]],
    });
    await expect(service.create(ACTOR, BODY)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('MethodologyAdminService.submit', () => {
  const SUBMIT = { versionId: VERSION_ID, note: 'Pronta para revisão CREF' };

  it('DRAFT → IN_REVIEW', async () => {
    const { service, audit } = methodologyWith({
      executes: [
        [], // lockVersion
        [{ created_by: ACTOR.userId, status: 'DRAFT' }], // loadCurrent
        [], // appendEvent(IN_REVIEW)
        [versionRow({ status: 'IN_REVIEW' })], // list()
      ],
    });

    await service.submit(ACTOR, SUBMIT);

    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'methodology.submit' }),
    );
  });

  it('recusa transição fora de DRAFT', async () => {
    const { service } = methodologyWith({
      executes: [[], [{ created_by: ACTOR.userId, status: 'PUBLISHED' }]],
    });
    await expect(service.submit(ACTOR, SUBMIT)).rejects.toBeInstanceOf(ConflictException);
  });

  it('404 quando a versão não existe', async () => {
    const { service } = methodologyWith({ executes: [[], []] });
    await expect(service.submit(ACTOR, SUBMIT)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('MethodologyAdminService.review', () => {
  const REVIEW = { versionId: VERSION_ID, note: 'Parecer técnico registrado' };

  it('aprova quando o revisor é diferente do autor', async () => {
    const { service, audit } = methodologyWith({
      executes: [
        [], // lockVersion
        CREF_OK, // assertActiveCref
        [{ created_by: OTHER_CREF, status: 'IN_REVIEW' }], // loadCurrent
        [], // appendEvent(APPROVED)
        [versionRow({ status: 'APPROVED' })], // list()
      ],
    });

    await service.review(ACTOR, REVIEW, 'APPROVED');

    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'methodology.approve' }),
    );
  });

  it('rejeita quando o revisor é diferente do autor', async () => {
    const { service, audit } = methodologyWith({
      executes: [
        [],
        CREF_OK,
        [{ created_by: OTHER_CREF, status: 'IN_REVIEW' }],
        [],
        [versionRow()],
      ],
    });

    await service.review(ACTOR, REVIEW, 'REJECTED');

    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'methodology.reject' }),
    );
  });

  it('maker-checker: o autor não pode aprovar a própria versão', async () => {
    const { service } = methodologyWith({
      executes: [[], CREF_OK, [{ created_by: ACTOR.userId, status: 'IN_REVIEW' }]],
    });
    await expect(service.review(ACTOR, REVIEW, 'APPROVED')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('recusa revisar sem profissional CREF ativo', async () => {
    const { service } = methodologyWith({ executes: [[], []] });
    await expect(service.review(ACTOR, REVIEW, 'APPROVED')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('recusa revisar versão que não está IN_REVIEW', async () => {
    const { service } = methodologyWith({
      executes: [[], CREF_OK, [{ created_by: OTHER_CREF, status: 'DRAFT' }]],
    });
    await expect(service.review(ACTOR, REVIEW, 'APPROVED')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('404 quando a versão não existe', async () => {
    const { service } = methodologyWith({ executes: [[], CREF_OK, []] });
    await expect(service.review(ACTOR, REVIEW, 'APPROVED')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('MethodologyAdminService.publish', () => {
  const PUBLISH = { versionId: VERSION_ID, note: 'Publicação autorizada pelo RT' };

  it('publica, arquiva a versão anterior e invalida o cache do provider', async () => {
    const { service, audit, provider } = methodologyWith({
      executes: [
        [], // advisory lock
        CREF_OK, // assertActiveCref
        [{ created_by: OTHER_CREF, status: 'APPROVED' }], // loadCurrent
        [{ id: '55555555-5555-4555-8555-555555555555' }], // versão publicada anterior a arquivar
        [], // appendEvent(ARCHIVED) da anterior
        [], // appendEvent(PUBLISHED) da nova
        [versionRow({ status: 'PUBLISHED' })], // list()
      ],
    });

    await service.publish(ACTOR, PUBLISH);

    expect(provider.invalidate).toHaveBeenCalledOnce();
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'methodology.publish',
        changes: expect.objectContaining({
          archived: ['55555555-5555-4555-8555-555555555555'],
        }),
      }),
    );
  });

  it('primeira publicação (sem versão anterior) não tenta arquivar nada', async () => {
    const { service, provider } = methodologyWith({
      executes: [
        [],
        CREF_OK,
        [{ created_by: OTHER_CREF, status: 'APPROVED' }],
        [], // nenhuma versão publicada anteriormente
        [], // appendEvent(PUBLISHED)
        [versionRow({ status: 'PUBLISHED' })],
      ],
    });

    await service.publish(ACTOR, PUBLISH);
    expect(provider.invalidate).toHaveBeenCalledOnce();
  });

  it('maker-checker: o autor não pode publicar a própria versão', async () => {
    const { service, provider } = methodologyWith({
      executes: [[], CREF_OK, [{ created_by: ACTOR.userId, status: 'APPROVED' }]],
    });
    await expect(service.publish(ACTOR, PUBLISH)).rejects.toBeInstanceOf(ConflictException);
    expect(provider.invalidate).not.toHaveBeenCalled();
  });

  it('recusa publicar versão que não está APPROVED', async () => {
    const { service } = methodologyWith({
      executes: [[], CREF_OK, [{ created_by: OTHER_CREF, status: 'IN_REVIEW' }]],
    });
    await expect(service.publish(ACTOR, PUBLISH)).rejects.toBeInstanceOf(ConflictException);
  });

  it('recusa publicar sem profissional CREF ativo', async () => {
    const { service } = methodologyWith({ executes: [[], []] });
    await expect(service.publish(ACTOR, PUBLISH)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('MethodologyAdminService.rollback', () => {
  const ROLLBACK = { versionId: VERSION_ID, note: 'Reverter para a v1 aprovada' };

  it('cria um novo DRAFT com o conteúdo da versão de origem', async () => {
    const { service, audit } = methodologyWith({
      executes: [
        [], // advisory lock
        [{ content: 'conteúdo histórico assinado pelo CREF' }], // source
        [{ id: '66666666-6666-4666-8666-666666666666', version: 3 }], // insert RETURNING
        [], // appendEvent(DRAFT)
        [versionRow({ version: 3, status: 'DRAFT' })], // list()
      ],
    });

    await service.rollback(ACTOR, ROLLBACK);

    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'methodology.rollback.create',
        changes: expect.objectContaining({ sourceVersionId: VERSION_ID, version: 3 }),
      }),
    );
  });

  it('404 quando a versão de origem não existe', async () => {
    const { service } = methodologyWith({ executes: [[], []] });
    await expect(service.rollback(ACTOR, ROLLBACK)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('recusa corpo fora do contrato', async () => {
    const { service, execute } = methodologyWith();
    await expect(service.rollback(ACTOR, { versionId: 'nao-uuid' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(execute).not.toHaveBeenCalled();
  });
});

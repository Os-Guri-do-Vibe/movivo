import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import type { ExerciseCatalogProvider } from '../protocol/exercise-catalog-provider.service';
import type { AuditService } from './audit.service';
import { ExerciseCatalogAdminService } from './exercise-catalog-admin.service';

const ACTOR = {
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'ADMIN',
  jti: 'j1',
} as const as AuthenticatedUser;

const VALID = {
  exerciseKey: 'agachamento_teste',
  name: 'Agachamento Teste',
  pattern: 'SQUAT' as const,
  muscleGroups: ['quadríceps'],
  equipment: [],
  locations: ['FULL_GYM' as const],
  minLevel: 'INICIANTE' as const,
  contraindicatedFor: ['KNEE' as const],
  substitutes: [] as string[],
  changeNote: 'entrada de teste',
};

/** Linha devolvida por `list()` — o formato que o envelope serializa. */
function listRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    exerciseKey: VALID.exerciseKey,
    name: VALID.name,
    pattern: VALID.pattern,
    muscleGroups: VALID.muscleGroups,
    equipment: VALID.equipment,
    locations: VALID.locations,
    minLevel: VALID.minLevel,
    contraindicatedFor: VALID.contraindicatedFor,
    substitutes: VALID.substitutes,
    measurement: null,
    durationSecondsRange: null,
    minRestSeconds: null,
    videoUrl: null,
    version: 1,
    status: 'PUBLISHED',
    changeNote: 'nota',
    createdAt: new Date('2026-09-02T12:00:00.000Z'),
    createdBy: 'Mariana',
    ...overrides,
  };
}

/**
 * `selects` são consumidos em ordem pelas chamadas a `tx.select` (nextVersion, list());
 * `selectsDistinct` pelas chamadas a `tx.selectDistinct` (validateSubstitutes) — filas
 * independentes, cada `tx.*` tem a sua (mesmo molde de `faq-admin.service.spec.ts`, com
 * a fila extra que o FAQ não precisa).
 */
function catalogWith(
  options: {
    selects?: unknown[][];
    selectsDistinct?: unknown[][];
    /** `false` simula o `.returning()` do insert vindo vazio (linha de segurança). */
    insertReturns?: boolean;
  } = {},
) {
  const { selects = [], selectsDistinct = [], insertReturns = true } = options;
  const inserted: unknown[] = [];
  const chainFor = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {
      from: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(rows),
      then: (onfulfilled: (value: unknown[]) => unknown) => Promise.resolve(rows).then(onfulfilled),
    };
    return chain;
  };
  const select = vi.fn();
  const selectDistinct = vi.fn();
  for (const rows of selects) select.mockImplementationOnce(() => chainFor(rows));
  for (const rows of selectsDistinct) selectDistinct.mockImplementationOnce(() => chainFor(rows));
  select.mockImplementation(() => chainFor([]));
  selectDistinct.mockImplementation(() => chainFor([]));
  const execute = vi.fn(async () => []);
  const tx = {
    select,
    selectDistinct,
    execute,
    insert: () => ({
      values: (values: unknown) => {
        inserted.push(values);
        return {
          returning: async () =>
            insertReturns ? [{ id: '55555555-5555-4555-8555-555555555555' }] : [],
        };
      },
    }),
  };
  const db = {
    runAsSystem: vi.fn((cb: (value: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as TenantDatabase;
  const audit = { append: vi.fn().mockResolvedValue(undefined) };
  const invalidate = vi.fn();
  const service = new ExerciseCatalogAdminService(
    db,
    { invalidate } as unknown as ExerciseCatalogProvider,
    audit as unknown as AuditService,
  );
  return { service, audit, inserted, invalidate };
}

describe('ExerciseCatalogAdminService.list', () => {
  it('marca como corrente apenas a versão mais recente de cada exerciseKey', async () => {
    const { service } = catalogWith({
      selects: [
        [
          listRow({ id: 'a', version: 2 }),
          listRow({ id: 'b', version: 1 }),
          listRow({ id: 'c', version: 1, exerciseKey: 'outro_exercicio' }),
        ],
      ],
    });

    const response = await service.list();

    expect(response.data.versions.map((v) => [v.id, v.current])).toEqual([
      ['a', true],
      ['b', false],
      ['c', true],
    ]);
  });

  it('conta só as versões correntes PUBLISHED em totalPublished', async () => {
    const { service } = catalogWith({
      selects: [
        [
          listRow({ id: 'a', version: 2, status: 'RETIRED' }),
          listRow({ id: 'b', version: 1, status: 'PUBLISHED' }),
        ],
      ],
    });

    const response = await service.list();

    expect(response.data.totalPublished).toBe(0); // "a" é o corrente, e está RETIRED
  });
});

describe('ExerciseCatalogAdminService.publish', () => {
  it('cria a v1 com exerciseKey novo e audita como exercise_catalog.publish', async () => {
    const { service, audit, inserted, invalidate } = catalogWith({ selects: [[{ max: 0 }], []] });

    await service.publish(ACTOR, VALID);

    expect(inserted[0]).toMatchObject({
      exerciseKey: VALID.exerciseKey,
      version: 1,
      status: 'PUBLISHED',
      createdBy: ACTOR.userId,
    });
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'exercise_catalog.publish',
        entityType: 'exercise_catalog_entry',
      }),
    );
    expect(invalidate).toHaveBeenCalledOnce();
  });

  it('nova versão do mesmo exerciseKey incrementa a versão', async () => {
    const { service, inserted } = catalogWith({ selects: [[{ max: 3 }], []] });

    await service.publish(ACTOR, VALID);

    expect(inserted[0]).toMatchObject({ exerciseKey: VALID.exerciseKey, version: 4 });
  });

  it('recusa corpo fora do contrato antes de tocar o banco', async () => {
    const { service, inserted } = catalogWith();
    await expect(service.publish(ACTOR, { name: 'curto' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(inserted).toHaveLength(0);
  });

  it('recusa um exercício como substituto de si mesmo', async () => {
    const { service, inserted } = catalogWith();
    await expect(
      service.publish(ACTOR, { ...VALID, substitutes: [VALID.exerciseKey] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(inserted).toHaveLength(0);
  });

  it('recusa substituto inexistente no catálogo', async () => {
    const { service, inserted } = catalogWith({ selectsDistinct: [[]] });
    await expect(
      service.publish(ACTOR, { ...VALID, substitutes: ['inexistente_no_catalogo'] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(inserted).toHaveLength(0);
  });

  it('aceita um substituto que existe no catálogo', async () => {
    const { service, inserted } = catalogWith({
      selects: [[{ max: 0 }], []],
      selectsDistinct: [[{ exerciseKey: 'outro_valido' }]],
    });
    await service.publish(ACTOR, { ...VALID, substitutes: ['outro_valido'] });
    expect(inserted[0]).toMatchObject({ substitutes: ['outro_valido'] });
  });

  it('assume v1 quando o select de próxima versão não devolve nenhuma linha', async () => {
    const { service, inserted } = catalogWith({ selects: [[], []] });
    await service.publish(ACTOR, VALID);
    expect(inserted[0]).toMatchObject({ version: 1 });
  });

  it('400 quando o insert não devolve a linha criada', async () => {
    const { service } = catalogWith({ selects: [[{ max: 0 }]], insertReturns: false });
    await expect(service.publish(ACTOR, VALID)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ExerciseCatalogAdminService.retire', () => {
  it('grava uma versão RETIRED preservando os dados correntes', async () => {
    const { service, audit, inserted } = catalogWith({
      selects: [[listRow({ status: 'PUBLISHED' })], [{ max: 1 }], []],
    });

    await service.retire(ACTOR, { exerciseKey: VALID.exerciseKey, changeNote: 'saiu do escopo' });

    expect(inserted[0]).toMatchObject({ version: 2, status: 'RETIRED' });
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'exercise_catalog.retire' }),
    );
  });

  it('preserva measurement/durationSecondsRange/minRestSeconds/videoUrl quando presentes', async () => {
    const { service, inserted } = catalogWith({
      selects: [
        [
          listRow({
            status: 'PUBLISHED',
            measurement: 'DURATION',
            durationSecondsRange: { min: 10, max: 60 },
            minRestSeconds: 0,
            videoUrl: 'https://movivo.test/v.mp4',
          }),
        ],
        [{ max: 1 }],
        [],
      ],
    });

    await service.retire(ACTOR, { exerciseKey: VALID.exerciseKey, changeNote: 'saiu do escopo' });

    expect(inserted[0]).toMatchObject({
      measurement: 'DURATION',
      durationSecondsRange: { min: 10, max: 60 },
      minRestSeconds: 0,
      videoUrl: 'https://movivo.test/v.mp4',
    });
  });

  it('não retira duas vezes o mesmo exercício', async () => {
    const { service } = catalogWith({ selects: [[listRow({ status: 'RETIRED' })]] });
    await expect(
      service.retire(ACTOR, { exerciseKey: VALID.exerciseKey, changeNote: 'de novo' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404 quando o exercício não existe', async () => {
    const { service } = catalogWith({ selects: [[]] });
    await expect(
      service.retire(ACTOR, { exerciseKey: VALID.exerciseKey, changeNote: 'inexistente' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

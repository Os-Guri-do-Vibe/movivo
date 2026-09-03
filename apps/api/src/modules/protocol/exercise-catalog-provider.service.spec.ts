import { describe, expect, it, vi } from 'vitest';

import type { TenantDatabase } from '../../core/database/tenant-database.service';
import { EXERCISE_CATALOG } from './exercise-catalog';
import { ExerciseCatalogProvider } from './exercise-catalog-provider.service';

describe('ExerciseCatalogProvider (achado 2026-09-02)', () => {
  it('sem TenantDatabase, serve o bootstrap estático de forma síncrona (nunca vazio)', () => {
    const provider = new ExerciseCatalogProvider();
    expect(provider.getAll().length).toBe(EXERCISE_CATALOG.length);
    expect(provider.isKnown('agachamento_peso_corporal')).toBe(true);
    expect(provider.getById('agachamento_peso_corporal')?.pattern).toBe('SQUAT');
  });

  it('isKnown/getById devolvem falso/undefined para id inexistente', () => {
    const provider = new ExerciseCatalogProvider();
    expect(provider.isKnown('exercicio_que_nao_existe')).toBe(false);
    expect(provider.getById('exercicio_que_nao_existe')).toBeUndefined();
  });

  it('refresh()/invalidate() sem db são no-op — não apaga o snapshot', async () => {
    const provider = new ExerciseCatalogProvider();
    const before = provider.getAll();
    await provider.refresh();
    await provider.invalidate();
    expect(provider.getAll()).toBe(before);
  });

  it('onModuleInit() sem db não lança e mantém o snapshot', async () => {
    const provider = new ExerciseCatalogProvider();
    await expect(provider.onModuleInit()).resolves.toBeUndefined();
    expect(provider.getAll().length).toBe(EXERCISE_CATALOG.length);
  });
});

/** Linha crua de `exercise_catalog_entries` (formato devolvido pelo `select()` do refresh). */
function row(overrides: Record<string, unknown> = {}) {
  return {
    exerciseKey: 'flexao',
    name: 'Flexão',
    pattern: 'HORIZONTAL_PUSH',
    muscleGroups: ['peito'],
    equipment: [],
    locations: ['HOME'],
    minLevel: 'INICIANTE',
    contraindicatedFor: ['SHOULDER'],
    substitutes: ['flexao_com_apoio_dos_joelhos'],
    measurement: null,
    durationSecondsRange: null,
    minRestSeconds: null,
    videoUrl: null,
    version: 1,
    status: 'PUBLISHED',
    ...overrides,
  };
}

function dbWith(selectRows: unknown[]) {
  const values = vi.fn(async () => undefined);
  const execute = vi.fn(async (): Promise<unknown> => [{ count: 0 }]);
  const tx = {
    select: () => ({
      from: () => ({
        orderBy: () => Promise.resolve(selectRows),
      }),
    }),
    execute,
    insert: () => ({ values }),
  };
  const db = {
    runAsSystem: vi.fn((cb: (value: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as TenantDatabase;
  return { db, execute, values };
}

describe('ExerciseCatalogProvider.refresh() — com TenantDatabase', () => {
  it('mantém só a versão mais recente de cada exerciseKey, filtrando RETIRED', async () => {
    const { db } = dbWith([
      row({ exerciseKey: 'flexao', version: 2, name: 'Flexão v2' }),
      row({ exerciseKey: 'flexao', version: 1, name: 'Flexão v1' }),
      row({ exerciseKey: 'agachamento', version: 1, status: 'RETIRED' }),
    ]);
    const provider = new ExerciseCatalogProvider(db);

    await provider.refresh();

    expect(provider.getAll()).toHaveLength(1);
    expect(provider.getById('flexao')?.name).toBe('Flexão v2');
    expect(provider.isKnown('agachamento')).toBe(false);
  });

  it('inclui os campos opcionais quando presentes na linha', async () => {
    const { db } = dbWith([
      row({
        exerciseKey: 'caminhada',
        measurement: 'DURATION',
        durationSecondsRange: { min: 300, max: 2400 },
        minRestSeconds: 0,
        videoUrl: 'https://movivo.test/caminhada.mp4',
      }),
    ]);
    const provider = new ExerciseCatalogProvider(db);

    await provider.refresh();

    expect(provider.getById('caminhada')).toMatchObject({
      measurement: 'DURATION',
      durationSecondsRange: { min: 300, max: 2400 },
      minRestSeconds: 0,
      videoUrl: 'https://movivo.test/caminhada.mp4',
    });
  });

  it('omite os campos opcionais quando ausentes na linha', async () => {
    const { db } = dbWith([row({ exerciseKey: 'flexao' })]);
    const provider = new ExerciseCatalogProvider(db);

    await provider.refresh();

    const entry = provider.getById('flexao');
    expect(entry).not.toHaveProperty('measurement');
    expect(entry).not.toHaveProperty('durationSecondsRange');
    expect(entry).not.toHaveProperty('minRestSeconds');
    expect(entry).not.toHaveProperty('videoUrl');
  });

  it('nunca esvazia o snapshot quando a leitura devolve zero PUBLISHED', async () => {
    const { db } = dbWith([row({ status: 'RETIRED' })]);
    const provider = new ExerciseCatalogProvider(db);
    const before = provider.getAll();

    await provider.refresh();

    expect(provider.getAll()).toBe(before);
  });
});

describe('ExerciseCatalogProvider.invalidate() — com TenantDatabase', () => {
  it('chama refresh() e atualiza o snapshot', async () => {
    const { db } = dbWith([row({ exerciseKey: 'novo_exercicio' })]);
    const provider = new ExerciseCatalogProvider(db);

    await provider.invalidate();

    expect(provider.isKnown('novo_exercicio')).toBe(true);
  });
});

describe('ExerciseCatalogProvider — ensureBootstrap (via onModuleInit)', () => {
  // `ensureBootstrap` é privado e só é chamado por `onModuleInit`, que já barra `!this.db`
  // ANTES de chegar lá — o guard duplicado dentro dele é defesa em profundidade
  // estruturalmente inalcançável pela API pública hoje. Chamado direto aqui (via cast)
  // pra provar que o guard em si é seguro, sem forçar um `v8 ignore` numa linha que É
  // lógica real (diferente do artefato do decorator acima).
  it('ensureBootstrap() é no-op se chamado sem db (defesa em profundidade)', async () => {
    const provider = new ExerciseCatalogProvider() as unknown as {
      ensureBootstrap(): Promise<void>;
    };
    await expect(provider.ensureBootstrap()).resolves.toBeUndefined();
  });

  it('pula a migração quando já existe alguma linha na tabela', async () => {
    const { db, execute, values } = dbWith([]);
    execute.mockResolvedValueOnce(undefined).mockResolvedValueOnce([{ count: 5 }]);
    const provider = new ExerciseCatalogProvider(db);

    await provider.onModuleInit();

    expect(values).not.toHaveBeenCalled();
  });

  it('migra todo o catálogo estático quando a tabela está vazia', async () => {
    const { db, execute, values } = dbWith([]);
    execute.mockResolvedValueOnce(undefined).mockResolvedValueOnce([{ count: 0 }]);
    const provider = new ExerciseCatalogProvider(db);

    await provider.onModuleInit();

    expect(values).toHaveBeenCalledTimes(EXERCISE_CATALOG.length);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PUBLISHED', version: 1, createdBy: null }),
    );
  });

  it('assume zero linhas quando o count vem sem `rows[0]`', async () => {
    const { db, execute, values } = dbWith([]);
    execute.mockResolvedValueOnce(undefined).mockResolvedValueOnce([]);
    const provider = new ExerciseCatalogProvider(db);

    await provider.onModuleInit();

    expect(values).toHaveBeenCalledTimes(EXERCISE_CATALOG.length);
  });
});

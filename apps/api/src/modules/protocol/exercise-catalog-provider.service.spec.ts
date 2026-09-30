import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { exerciseCatalogFavorites } from '../../core/database/schema';
import type { TenantDatabase } from '../../core/database/tenant-database.service';
import { EXERCISE_CATALOG } from './exercise-catalog';
import { ExerciseCatalogProvider, levelsOfRow } from './exercise-catalog-provider.service';

describe('ExerciseCatalogProvider (achado 2026-09-02)', () => {
  it('sem TenantDatabase, serve o bootstrap estático de forma síncrona (nunca vazio)', () => {
    const provider = new ExerciseCatalogProvider();
    expect(provider.getAll().length).toBe(EXERCISE_CATALOG.length);
    expect(provider.isKnown('agachamento_peso_corporal')).toBe(true);
    expect(provider.getById('agachamento_peso_corporal')?.pattern).toBe('SQUAT');
    // Achado 2026-09-26: favorito só vem do banco — bootstrap não sabe, fica `undefined`.
    expect(provider.getById('agachamento_peso_corporal')?.isFavorite).toBeUndefined();
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
    levels: ['INICIANTE', 'INTERMEDIARIO', 'AVANCADO'],
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

/**
 * `favorites`: chaves em `exercise_catalog_favorites` — ou um `Error` para simular falha na
 * leitura dessa tabela (achado 2026-09-26), sem afetar a leitura de `exercise_catalog_entries`.
 */
function dbWith(selectRows: unknown[], favorites: readonly string[] | Error = []) {
  const values = vi.fn(async () => undefined);
  const execute = vi.fn(async (): Promise<unknown> => [{ count: 0 }]);
  const tx = {
    select: () => ({
      from: (table: unknown) =>
        table === exerciseCatalogFavorites
          ? favorites instanceof Error
            ? Promise.reject(favorites)
            : Promise.resolve(favorites.map((exerciseKey) => ({ exerciseKey })))
          : { orderBy: () => Promise.resolve(selectRows) },
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

  // 2026-09-29: `levels` é a fonte de verdade; `min_level` só é lido quando `levels` é nulo
  // (linha escrita pela API anterior depois de um rollback).
  it('usa `levels` da linha quando presente (inclusive conjunto não contíguo)', async () => {
    const { db } = dbWith([row({ minLevel: 'INICIANTE', levels: ['INICIANTE', 'AVANCADO'] })]);
    const provider = new ExerciseCatalogProvider(db);
    await provider.refresh();
    expect(provider.getById('flexao')?.levels).toEqual(['INICIANTE', 'AVANCADO']);
    expect(provider.getById('flexao')).not.toHaveProperty('minLevel');
  });

  it.each([
    ['INICIANTE', ['INICIANTE', 'INTERMEDIARIO', 'AVANCADO']],
    ['INTERMEDIARIO', ['INTERMEDIARIO', 'AVANCADO']],
    ['AVANCADO', ['AVANCADO']],
  ])('`levels` nulo cai na derivação de min_level=%s', async (minLevel, expected) => {
    const { db } = dbWith([row({ minLevel, levels: null })]);
    const provider = new ExerciseCatalogProvider(db);
    await provider.refresh();
    expect(provider.getById('flexao')?.levels).toEqual(expected);
  });

  it('`levels: []` (nunca deveria existir) também cai na derivação de min_level — fail-safe', () => {
    expect(levelsOfRow({ levels: [], minLevel: 'INTERMEDIARIO' })).toEqual([
      'INTERMEDIARIO',
      'AVANCADO',
    ]);
  });

  it('seed/bootstrap deriva `levels` de `minLevel` com o mesmo mapeamento do backfill', () => {
    // `agachamento_barra` é INTERMEDIARIO no seed; `flexao`, INICIANTE.
    expect(new ExerciseCatalogProvider().getById('agachamento_barra')?.levels).toEqual([
      'INTERMEDIARIO',
      'AVANCADO',
    ]);
    expect(new ExerciseCatalogProvider().getById('flexao')?.levels).toEqual([
      'INICIANTE',
      'INTERMEDIARIO',
      'AVANCADO',
    ]);
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

describe('ExerciseCatalogProvider.refresh() — favoritos do RT (achado 2026-09-26)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('marca isFavorite: true na chave favoritada e false nas demais', async () => {
    const { db } = dbWith(
      [
        row({ exerciseKey: 'flexao' }),
        row({ exerciseKey: 'remada_invertida', name: 'Remada Invertida' }),
        row({ exerciseKey: 'agachamento', status: 'RETIRED' }),
      ],
      // `agachamento` favoritado mas RETIRED: favorito nunca ressuscita exercício retirado.
      ['remada_invertida', 'agachamento'],
    );
    const provider = new ExerciseCatalogProvider(db);

    await provider.refresh();

    expect(provider.getById('remada_invertida')?.isFavorite).toBe(true);
    expect(provider.getById('flexao')?.isFavorite).toBe(false);
    expect(provider.isKnown('agachamento')).toBe(false);
  });

  it('falha ao ler favoritos NÃO impede o snapshot de exercícios de atualizar (cai para nenhum favorito)', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { db } = dbWith(
      [row({ exerciseKey: 'novo_exercicio' }), row({ exerciseKey: 'flexao' })],
      new Error('relation "exercise_catalog_favorites" does not exist'),
    );
    const provider = new ExerciseCatalogProvider(db);

    await expect(provider.refresh()).resolves.toBeUndefined();

    expect(provider.getAll()).toHaveLength(2);
    expect(provider.isKnown('novo_exercicio')).toBe(true);
    expect(provider.getAll().every((e) => e.isFavorite === false)).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'exercise_catalog_favorites_read_failed',
        err: expect.stringContaining('exercise_catalog_favorites'),
      }),
      expect.stringContaining('sem favoritos'),
    );
  });
});

describe('ExerciseCatalogProvider — log de falha com a causa real (validação 2026-09-29)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('inclui cause/code do erro do driver embrulhado pelo Drizzle no warn de favoritos', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const driverError = Object.assign(
      new Error('permission denied for table exercise_catalog_favorites'),
      { code: '42501' },
    );
    const { db } = dbWith(
      [row({ exerciseKey: 'flexao' })],
      new Error('Failed query: select "exercise_key" from "exercise_catalog_favorites"', {
        cause: driverError,
      }),
    );

    await new ExerciseCatalogProvider(db).refresh();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'exercise_catalog_favorites_read_failed',
        err: expect.stringContaining('Failed query'),
        cause: expect.stringContaining('permission denied'),
        code: '42501',
      }),
      expect.any(String),
    );
  });

  it('erro sem cause não inventa campos cause/code', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { db } = dbWith([row({ exerciseKey: 'flexao' })], new Error('conexão recusada'));

    await new ExerciseCatalogProvider(db).refresh();

    const [fields] = warn.mock.calls[0] ?? [];
    expect(fields).toEqual({
      event: 'exercise_catalog_favorites_read_failed',
      err: 'Error: conexão recusada',
    });
  });
});

describe('ExerciseCatalogProvider — timer de refresh (validação 2026-09-29)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('falha no refresh periódico é logada, nunca vira rejeição não tratada', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const { db, execute } = dbWith([row({ exerciseKey: 'flexao' })]);
    execute.mockResolvedValueOnce(undefined).mockResolvedValueOnce([{ count: 5 }]);
    const provider = new ExerciseCatalogProvider(db);
    await provider.onModuleInit();
    const before = provider.getAll();

    vi.mocked(db.runAsSystem).mockRejectedValue(new Error('Failed query', { cause: 'ECONNRESET' }));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await Promise.resolve();

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'exercise_catalog_refresh_failed', cause: 'ECONNRESET' }),
      expect.stringContaining('snapshot anterior'),
    );
    expect(provider.getAll()).toBe(before);
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    provider.onModuleDestroy();
  });

  it('onModuleDestroy() para o timer — nenhum refresh depois do shutdown', async () => {
    vi.useFakeTimers();
    const { db, execute } = dbWith([row({ exerciseKey: 'flexao' })]);
    execute.mockResolvedValueOnce(undefined).mockResolvedValueOnce([{ count: 5 }]);
    const provider = new ExerciseCatalogProvider(db);
    await provider.onModuleInit();
    const callsAfterInit = vi.mocked(db.runAsSystem).mock.calls.length;

    provider.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(15 * 60_000);

    expect(vi.mocked(db.runAsSystem).mock.calls.length).toBe(callsAfterInit);
  });

  it('onModuleDestroy() sem timer (sem db) é no-op', () => {
    expect(() => new ExerciseCatalogProvider().onModuleDestroy()).not.toThrow();
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
    // 2026-09-29: grava `levels` derivado do seed E `min_level` (menor nível — rollback).
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        exerciseKey: 'agachamento_barra',
        levels: ['INTERMEDIARIO', 'AVANCADO'],
        minLevel: 'INTERMEDIARIO',
      }),
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

import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { TenantDatabase } from '../../core/database/tenant-database.service';
import type { AuthenticatedUser } from '../auth/jwt.strategy';
import type { FoodCatalogService } from '../catalog/foods/food-catalog.service';
import type { AuditService } from './audit.service';
import { TacoAdminService } from './taco-admin.service';

const ACTOR = {
  userId: '22222222-2222-4222-8222-222222222222',
  role: 'ADMIN',
  jti: 'j1',
} as const as AuthenticatedUser;

const HEADER =
  'Número do Alimento;Descrição dos alimentos;Energia (kcal);Proteína (g);Lipídeos (g);Carboidrato (g)';
const csv = (...rows: string[]) => [HEADER, ...rows].join('\n');
const ARROZ = '1;Arroz, integral, cozido;124;2,6;1,0;25,8';

/** Cada `tx.select(...)` resolve com a próxima resposta da fila, qualquer que seja a cadeia. */
function build(selects: unknown[][] = []) {
  const queue = [...selects];
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'groupBy', 'orderBy']) chain[method] = () => chain;
  chain.then = (resolve: (value: unknown) => void) => resolve(queue.shift() ?? []);
  const tx = { select: vi.fn(() => chain) };
  const db = {
    runAsSystem: vi.fn((fn: (t: typeof tx) => unknown) => Promise.resolve(fn(tx))),
  } as unknown as TenantDatabase;
  const foods = { importTaco: vi.fn((items: readonly unknown[]) => Promise.resolve(items.length)) };
  const audit = { append: vi.fn().mockResolvedValue(undefined) };
  const service = new TacoAdminService(
    db,
    foods as unknown as FoodCatalogService,
    audit as unknown as AuditService,
  );
  return { service, foods, audit };
}

const SUMMARY_ROWS = [
  [
    { source: 'TACO', total: 597 },
    { source: 'CUSTOM', total: 28 },
  ],
  [{ name: 'Cereais e derivados', count: 40 }],
  [{ at: new Date('2026-10-31T15:00:00.000Z') }],
];

describe('TacoAdminService', () => {
  it('resume a base: TACO, outras fontes, categorias e última atualização', async () => {
    const { service } = build(SUMMARY_ROWS);

    const { data, meta } = await service.status();

    expect(data).toEqual({
      tacoCount: 597,
      otherCount: 28,
      lastImportedAt: '2026-10-31T15:00:00.000Z',
      categories: [{ name: 'Cereais e derivados', count: 40 }],
      lastImport: null,
    });
    expect(meta.timezone).toBe('America/Sao_Paulo');
  });

  it('base vazia: zeros e sem data', async () => {
    const { service } = build([[], [], [{ at: null }]]);

    const { data } = await service.status();

    expect(data).toMatchObject({ tacoCount: 0, otherCount: 0, lastImportedAt: null });
  });

  it('lista a TACO e os complementos na ordem numérica da planilha, sem os sem código', async () => {
    const per100g = {
      energyKcal: 124,
      proteinG: 2.6,
      fatG: 1,
      carbsG: 25.8,
      fiberG: null,
      micros: {},
    };
    const row = (source: string, sourceCode: string | null, name: string) => ({
      id: `id-${name}`,
      source,
      sourceCode,
      name,
      category: 'Cereais e derivados',
      per100g,
    });
    const { service } = build([
      [
        row('TACO', '10', 'Dez'),
        row('TACO', '2', 'Dois'),
        row('CUSTOM', 'USDA-458', 'Leite'),
        row('TACO', null, 'Sem código'),
        row('TACO', '1', 'Um'),
        row('CUSTOM', 'SemTraco', 'Da equipe'),
      ],
    ]);

    const { data, meta } = await service.listFoods();

    expect(data.foods.map((food) => [food.code, food.origin])).toEqual([
      ['1', null],
      ['2', null],
      ['10', null],
      ['458', 'USDA'],
      ['SemTraco', 'Equipe'],
    ]);
    expect(data.foods[0]).toMatchObject({ name: 'Um', category: 'Cereais e derivados', per100g });
    expect(meta.timezone).toBe('America/Sao_Paulo');
  });

  it('importa, audita sem o conteúdo do arquivo e devolve o resultado', async () => {
    const { service, foods, audit } = build(SUMMARY_ROWS);

    const { data } = await service.importCsv(ACTOR, {
      csv: csv(ARROZ, ';sem número nem macros;;;;'),
      fileName: 'taco.csv',
    });

    expect(foods.importTaco).toHaveBeenCalledWith([
      expect.objectContaining({ sourceCode: '1', name: 'Arroz, integral, cozido' }),
    ]);
    expect(data.lastImport).toEqual({ imported: 1, skipped: 1 });
    expect(audit.append).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorId: ACTOR.userId,
        action: 'taco.import',
        changes: { imported: 1, skipped: 1, fileName: 'taco.csv' },
      }),
    );
  });

  it('recusa corpo fora do contrato', async () => {
    const { service, foods } = build();

    await expect(service.importCsv(ACTOR, { csv: 'curto' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(foods.importTaco).not.toHaveBeenCalled();
  });

  it('recusa CSV sem as colunas obrigatórias', async () => {
    const { service, foods } = build();

    await expect(
      service.importCsv(ACTOR, { csv: `Nome;Valor\n${'x;1\n'.repeat(20)}` }),
    ).rejects.toThrow(/coluna obrigatória ausente/);
    expect(foods.importTaco).not.toHaveBeenCalled();
  });

  it('recusa CSV em que nenhuma linha tem dados mínimos', async () => {
    const { service } = build();

    await expect(
      service.importCsv(ACTOR, {
        csv: csv(...Array.from({ length: 8 }, () => '1;Sem dados;NA;NA;NA;NA')),
      }),
    ).rejects.toThrow(/Nenhum alimento/);
  });

  it.each([
    ['energia', '1;Fora;5000;1;1;1', /energia de 5000 kcal/],
    ['proteína', '1;Fora;100;150;1;1', /proteína de 150 g/],
    ['soma dos macros', '1;Fora;400;60;40;60', /somam mais de 100 g/],
  ])(
    'recusa o arquivo inteiro com %s implausível, sem importar nada',
    async (_label, row, message) => {
      const { service, foods } = build();

      await expect(service.importCsv(ACTOR, { csv: csv(ARROZ, row) })).rejects.toThrow(message);
      expect(foods.importTaco).not.toHaveBeenCalled();
    },
  );
});

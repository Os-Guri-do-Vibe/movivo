/**
 * Integração — favoritos do catálogo de exercícios (achado 2026-09-26, validação 2026-09-29).
 *
 * O fundador reportou em produção que favoritar "não funcionava" e que a IA não priorizava
 * favoritos. Toda a validação anterior do lado API era com `tx` mockado — nenhuma prova de
 * que, com a role de runtime `movivo_app` via PgBouncer, a linha é gravada, a auditoria
 * encadeada aceita o insert, o snapshot em memória do `ExerciseCatalogProvider` reflete a
 * mudança e o system prompt da geração carrega a marcação. Este arquivo prova isso por I/O
 * real, ponta a ponta:
 *
 *   1. HTTP real (`AppModule` inteiro, login Argon2id/RS256 de verdade) sobre
 *      `POST /control-center/ai/exercise-catalog/favorite|unfavorite` + `GET` do catálogo:
 *      gravação, idempotência, auditoria encadeada, RBAC (`AI_CONFIG_WRITE`), 400/404.
 *   2. Motor: a MESMA instância de `ExerciseCatalogProvider` injetada no gerador enxerga o
 *      favorito logo após o endpoint (via `invalidate()`, sem esperar o timer de 5 min), e o
 *      system prompt real de `ProtocolGeneratorService.generate()` — capturado por um
 *      `LlmRouter` falso que só registra o `system` e aborta — tem a marcação, a ordem e o
 *      bloco de preferência corretos (inclusive o caso do fundador: favorito só de academia
 *      com aluno em casa não aparece).
 *   3. Falha silenciosa: no caminho feliz NENHUM warn `exercise_catalog_favorites_read_failed`
 *      é emitido; com permissão realmente revogada da role de runtime, o warn aparece e o
 *      snapshot de exercícios continua atualizando (degradação segura).
 *
 * Favorito é GLOBAL (uma tabela sem escopo de ator): o teste salva os favoritos que já
 * existirem no banco local, trabalha com a tabela vazia e os restaura no `afterAll`. Não
 * rode este arquivo enquanto alguém usa o painel de Exercícios contra o MESMO banco local
 * (uma API `nest start --watch` aberta): favoritar ali durante a janela do teste corre
 * contra o esvaziamento/restauração — e essa API também consumiria os jobs BullMQ de
 * outros int-specs com o gerador real.
 */
import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import { type INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../src/app.module';
import { AppConfigService } from '../src/core/config';
import { loadEnv } from '../src/core/config/load-env';
import { TenantDatabase } from '../src/core/database';
import { SEMANTIC_MEMORY } from '../src/modules/ai-coach/context/semantic-memory.port';
import type { LLMRequest } from '../src/modules/ai-coach/llm/llm.types';
import { LlmRouter } from '../src/modules/ai-coach/llm/llm-router.service';
import { ExerciseCatalogAdminService } from '../src/modules/admin/exercise-catalog-admin.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { ExerciseCatalogProvider } from '../src/modules/protocol/exercise-catalog-provider.service';
import { ProtocolGeneratorService } from '../src/modules/protocol/protocol-generator.service';
import type { UserConstraints } from '../src/modules/protocol/user-constraints';

const { env } = loadEnv();
const RUN = Date.now().toString().slice(-8);
const PASSWORD = 'Senha-Forte-Favoritos-123!';
const adminEmail = `fav_admin_${RUN}@movivo.test`;
const proEmail = `fav_pro_${RUN}@movivo.test`;

/** Só academia (FULL_GYM), com equipamento, contraindicado para KNEE — o caso do fundador. */
const GYM_ONLY = 'cadeira_flexora_maquina';
/** Serve todos os locais, sem equipamento, INICIANTE, contraindicado para KNEE/HIP. */
const EVERYWHERE = 'agachamento_profundo';
/** Chave de teste com v1 PUBLISHED e v2 RETIRED (criada pelo migrador no `beforeAll`). */
const RETIRED_KEY = `teste_fav_retirado_${RUN}`;
const MISSING_KEY = `teste_fav_inexistente_${RUN}`;

const FAVORITE_MARKER = 'preferido pelo profissional CREF: sim';
const FAVORITE_BLOCK_HEADER = 'PREFERÊNCIA DE PRESCRIÇÃO DO PROFISSIONAL CREF:';
const READ_FAILED_EVENT = 'exercise_catalog_favorites_read_failed';

// Migrador (dono das tabelas, BYPASSRLS): só setup/teardown e leitura de verificação.
const migrator = postgres({
  host: env.MIGRATION_DATABASE_HOST ?? 'localhost',
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432),
  user: env.MIGRATION_DATABASE_USER ?? 'movivo_migrator',
  password: env.MIGRATION_DATABASE_PASSWORD,
  database: env.DATABASE_NAME ?? 'movivo',
  ssl: false,
  max: 1,
  prepare: false,
  idle_timeout: 5,
  onnotice: () => undefined,
});
const appRole = env.DATABASE_USER ?? 'movivo_app';

let app: INestApplication;
let prefix: string;
let adminId = '';
let proId = '';
let adminToken = '';
let proToken = '';
let savedFavorites: Array<{ exercise_key: string; favorited_by: string; favorited_at: Date }> = [];

/** `system` de cada chamada ao LLM falso — o gerador nunca chega a um provedor real. */
const capturedSystems: string[] = [];
const PROMPT_CAPTURED = 'prompt capturado — geração interrompida de propósito pelo teste';
const fakeLlm = {
  complete: vi.fn(async (req: LLMRequest) => {
    capturedSystems.push(req.system ?? '');
    throw new Error(PROMPT_CAPTURED);
  }),
};

// Espião instalado ANTES do boot: cobre também o `refresh()` do `onModuleInit`.
const warnSpy = vi.spyOn(Logger.prototype, 'warn');
const favoriteReadFailures = () =>
  warnSpy.mock.calls.filter(
    ([message]) =>
      typeof message === 'object' &&
      message !== null &&
      (message as { event?: unknown }).event === READ_FAILED_EVENT,
  );

const http = () => request(app.getHttpServer());
const url = (path = '') => `/${prefix}/control-center/ai/exercise-catalog${path}`;
const favorite = (exerciseKey: unknown, token = adminToken) =>
  http().post(url('/favorite')).set('Authorization', `Bearer ${token}`).send({ exerciseKey });
const unfavorite = (exerciseKey: unknown, token = adminToken) =>
  http().post(url('/unfavorite')).set('Authorization', `Bearer ${token}`).send({ exerciseKey });

interface CatalogVersion {
  exerciseKey: string;
  current: boolean;
  isFavorite: boolean;
  status: string;
}
const currentVersion = (body: { data: { versions: CatalogVersion[] } }, key: string) =>
  body.data.versions.find((v) => v.exerciseKey === key && v.current);

async function favoriteRows(key: string) {
  return migrator<{ id: string; favorited_by: string }[]>`
    SELECT id, favorited_by FROM exercise_catalog_favorites WHERE exercise_key = ${key}`;
}

async function auditRows(action: string, key: string) {
  return migrator<
    {
      id: string;
      actor_id: string;
      entity_type: string;
      entity_id: string;
      row_hash: string;
      previous_hash: string | null;
      hash_ok: boolean;
    }[]
  >`
    SELECT id, actor_id, entity_type, entity_id, row_hash, previous_hash,
           row_hash = encode(digest(concat_ws('|', coalesce(previous_hash, ''), actor_id::text,
             user_id::text, action, entity_type, entity_id::text, changes::text,
             created_at::text), 'sha256'), 'hex') AS hash_ok
      FROM audit_logs
     WHERE actor_id = ${adminId}::uuid AND action = ${action}
       AND changes->>'exerciseKey' = ${key}
     ORDER BY id`;
}

/** Deixa exatamente `keys` favoritadas, pelo endpoint real (invalida o snapshot). */
async function setFavorites(keys: readonly string[]) {
  const existing = await migrator<{ exercise_key: string }[]>`
    SELECT exercise_key FROM exercise_catalog_favorites`;
  for (const { exercise_key } of existing) {
    if (!keys.includes(exercise_key)) expect((await unfavorite(exercise_key)).status).toBe(201);
  }
  for (const key of keys) expect((await favorite(key)).status).toBe(201);
}

const BASE_CONSTRAINTS: UserConstraints = {
  goal: 'GAIN_MUSCLE',
  level: 'AVANCADO',
  trainingStatus: 'REGULAR',
  daysPerWeek: 3,
  preferredDays: ['MON', 'WED', 'FRI'],
  location: 'FULL_GYM',
  equipment: [],
  emphasis: [],
  avoid: [],
  injuryTags: [],
  injuriesRaw: [],
  requiresProfessionalReview: false,
  parqTags: [],
  parqTriggered: [],
};

/** System prompt REAL da geração para estas restrições (o LLM falso aborta logo depois). */
async function systemPromptFor(overrides: Partial<UserConstraints>): Promise<string> {
  capturedSystems.length = 0;
  await expect(
    app.get(ProtocolGeneratorService).generate({
      userId: randomUUID(),
      user: { name: 'Aluno Favoritos' },
      constraints: { ...BASE_CONSTRAINTS, ...overrides },
    }),
  ).rejects.toThrow(PROMPT_CAPTURED);
  expect(capturedSystems).toHaveLength(1);
  return capturedSystems[0] ?? '';
}

/** Linhas da BASE DE REFERÊNCIA, na ordem em que o modelo as lê. */
function referenceBase(system: string) {
  const start = system.indexOf('BASE DE REFERÊNCIA (use SOMENTE');
  const end = system.indexOf('SCHEMA DO JSON DE SAÍDA:', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return system
    .slice(start, end)
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => ({
      id: line.slice(2).split(' | ')[0] ?? '',
      favorite: line.endsWith(` | ${FAVORITE_MARKER}`),
      equipped: !line.includes(' | equip: nenhum | '),
    }));
}

beforeAll(async () => {
  // Estado global do banco local: guarda e esvazia os favoritos pré-existentes.
  savedFavorites = await migrator`
    SELECT exercise_key, favorited_by, favorited_at FROM exercise_catalog_favorites`;
  await migrator`DELETE FROM exercise_catalog_favorites`;

  // Exercício retirado real (v1 PUBLISHED → v2 RETIRED), mesmo formato do admin.
  for (const [version, status] of [
    [1, 'PUBLISHED'],
    [2, 'RETIRED'],
  ] as const) {
    await migrator`
      INSERT INTO exercise_catalog_entries
        (exercise_key, name, pattern, muscle_groups, equipment, locations, min_level,
         contraindicated_for, substitutes, version, status, change_note)
      VALUES (${RETIRED_KEY}, 'Teste retirado', 'SQUAT', '["quadríceps"]'::jsonb, '[]'::jsonb,
              '["HOME"]'::jsonb, 'INICIANTE', '[]'::jsonb, '[]'::jsonb, ${version}, ${status},
              'fixture de integração dos favoritos')`;
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LlmRouter)
    .useValue(fakeLlm)
    // RAG sem rede: a evidência não é o objeto deste teste (e o embedding local não tem saldo).
    .overrideProvider(SEMANTIC_MEMORY)
    .useValue({ retrieve: async () => [] })
    .compile();
  app = moduleRef.createNestApplication({ logger: false });
  app.use(cookieParser());
  prefix = app.get(AppConfigService).globalPrefix;
  app.setGlobalPrefix(prefix);
  await app.init();

  const hash = await app.get(PasswordService).hash(PASSWORD);
  [adminId, proId] = await app.get(TenantDatabase).runAsSystem(async (tx) => {
    const ids: [string, string] = ['', ''];
    for (const [index, phone, email, name, role] of [
      [0, `+55571${RUN}1`, adminEmail, 'Admin Favoritos Teste', 'ADMIN'],
      [1, `+55571${RUN}2`, proEmail, 'RT Favoritos Teste', 'PROFESSIONAL'],
    ] as const) {
      const rows = (await tx.execute(
        sql`INSERT INTO staff (phone_number, email, name, role, password_hash)
            VALUES (${phone}, ${email}, ${name}, ${role}, ${hash}) RETURNING id`,
      )) as unknown as Array<{ id: string }>;
      if (!rows[0]) throw new Error(`staff de teste ${role} não criado`);
      ids[index] = rows[0].id;
    }
    return ids;
  });

  for (const [email, assign] of [
    [adminEmail, (t: string) => (adminToken = t)],
    [proEmail, (t: string) => (proToken = t)],
  ] as const) {
    const res = await http().post(`/${prefix}/auth/login`).send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    assign(res.body.accessToken as string);
  }
}, 60_000);

afterAll(async () => {
  try {
    // Garantia extra caso o teste de permissão revogada tenha abortado no meio.
    await migrator.unsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON exercise_catalog_favorites TO "${appRole}"`,
    );
    await migrator`DELETE FROM exercise_catalog_favorites`;
    for (const fav of savedFavorites) {
      await migrator`
        INSERT INTO exercise_catalog_favorites (exercise_key, favorited_by, favorited_at)
        VALUES (${fav.exercise_key}, ${fav.favorited_by}::uuid, ${fav.favorited_at})`;
    }
    await migrator`DELETE FROM exercise_catalog_entries WHERE exercise_key = ${RETIRED_KEY}`;
    // `audit_logs` NÃO é limpo de propósito (mesma escolha do audit-search.int-spec): a
    // cadeia de hash é GLOBAL, e apagar as linhas deste teste quebra o encadeamento de
    // qualquer linha que outro processo (API local, outro spec) tenha gravado depois delas
    // — foi exatamente o que derrubou o teste de cadeia do protocol-pipeline.int-spec em
    // 2026-09-29. `actor_id` não tem FK para `staff`, então o ator ainda pode ser removido.
    await migrator`DELETE FROM staff WHERE id IN (${adminId}::uuid, ${proId}::uuid)`;
  } finally {
    warnSpy.mockRestore();
    await app?.close();
    await migrator.end({ timeout: 5 });
  }
}, 60_000);

describe('HTTP — favorite/unfavorite com role de runtime real', () => {
  it('favorite grava a linha, audita com hash encadeado e devolve isFavorite na versão corrente', async () => {
    const res = await favorite(GYM_ONLY);

    // POST sem @HttpCode → 201 (mesma convenção de publish/retire deste controller).
    expect(res.status).toBe(201);
    expect(currentVersion(res.body, GYM_ONLY)?.isFavorite).toBe(true);
    // Nenhum outro exercício "vira" favorito por tabela.
    expect(
      res.body.data.versions.filter((v: CatalogVersion) => v.current && v.isFavorite),
    ).toHaveLength(1);

    const rows = await favoriteRows(GYM_ONLY);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.favorited_by).toBe(adminId);

    const audit = await auditRows('exercise_catalog.favorite', GYM_ONLY);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      entity_type: 'exercise_catalog_favorite',
      entity_id: rows[0]?.id,
      hash_ok: true,
    });
    expect(audit[0]?.row_hash).not.toBe('0'.repeat(64));
  });

  it('é idempotente: 2ª chamada não duplica linha nem gera 2ª auditoria', async () => {
    const res = await favorite(GYM_ONLY);
    expect(res.status).toBe(201);
    expect(currentVersion(res.body, GYM_ONLY)?.isFavorite).toBe(true);
    expect(await favoriteRows(GYM_ONLY)).toHaveLength(1);
    expect(await auditRows('exercise_catalog.favorite', GYM_ONLY)).toHaveLength(1);
  });

  it('GET do catálogo reflete o favorito (e o RT com AI_CONFIG_READ consegue ler)', async () => {
    for (const token of [adminToken, proToken]) {
      const res = await http().get(url()).set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(currentVersion(res.body, GYM_ONLY)?.isFavorite).toBe(true);
      expect(currentVersion(res.body, EVERYWHERE)?.isFavorite).toBe(false);
    }
  });

  it('403 para ator sem AI_CONFIG_WRITE (PROFESSIONAL) e 401 sem token — nada é gravado', async () => {
    expect((await favorite(EVERYWHERE, proToken)).status).toBe(403);
    expect((await unfavorite(GYM_ONLY, proToken)).status).toBe(403);
    expect((await http().post(url('/favorite')).send({ exerciseKey: EVERYWHERE })).status).toBe(
      401,
    );
    expect(await favoriteRows(EVERYWHERE)).toHaveLength(0);
    expect(await favoriteRows(GYM_ONLY)).toHaveLength(1);
  });

  it('404 para exerciseKey inexistente e 400 para exercício retirado', async () => {
    const missing = await favorite(MISSING_KEY);
    expect(missing.status).toBe(404);
    const retired = await favorite(RETIRED_KEY);
    expect(retired.status).toBe(400);
    expect(await favoriteRows(MISSING_KEY)).toHaveLength(0);
    expect(await favoriteRows(RETIRED_KEY)).toHaveLength(0);
  });

  it.each([
    ['corpo vazio', undefined],
    ['fora do padrão', 'Cadeira Flexora!'],
    ['tipo errado', 42],
    ['curto demais', 'ab'],
  ])('400 INVALID_INPUT para corpo inválido (%s) em favorite e unfavorite', async (_, key) => {
    for (const call of [favorite, unfavorite]) {
      const res = await call(key);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('INVALID_INPUT');
    }
  });

  it('unfavorite remove a linha, audita uma vez e é idempotente', async () => {
    const res = await unfavorite(GYM_ONLY);
    expect(res.status).toBe(201);
    expect(currentVersion(res.body, GYM_ONLY)?.isFavorite).toBe(false);
    expect(await favoriteRows(GYM_ONLY)).toHaveLength(0);

    const again = await unfavorite(GYM_ONLY);
    expect(again.status).toBe(201);

    const audit = await auditRows('exercise_catalog.unfavorite', GYM_ONLY);
    expect(audit).toHaveLength(1);
    expect(audit[0]?.hash_ok).toBe(true);

    const list = await http().get(url()).set('Authorization', `Bearer ${adminToken}`);
    expect(currentVersion(list.body, GYM_ONLY)?.isFavorite).toBe(false);
  });
});

describe('Motor — snapshot do ExerciseCatalogProvider e system prompt da geração', () => {
  it('admin e gerador compartilham a MESMA instância do provider (invalidate chega ao motor)', () => {
    const provider = app.get(ExerciseCatalogProvider);
    const viaAdmin = (app.get(ExerciseCatalogAdminService) as unknown as { catalog: unknown })
      .catalog;
    const viaGenerator = (app.get(ProtocolGeneratorService) as unknown as { catalog: unknown })
      .catalog;
    expect(viaAdmin).toBe(provider);
    expect(viaGenerator).toBe(provider);
  });

  it('logo após o endpoint (sem esperar o timer), o snapshot marca só as chaves favoritadas', async () => {
    await setFavorites([GYM_ONLY, EVERYWHERE]);
    const provider = app.get(ExerciseCatalogProvider);

    expect(provider.getById(GYM_ONLY)?.isFavorite).toBe(true);
    expect(provider.getById(EVERYWHERE)?.isFavorite).toBe(true);
    expect(
      provider
        .getAll()
        .filter((e) => e.isFavorite)
        .map((e) => e.id)
        .sort(),
    ).toEqual([EVERYWHERE, GYM_ONLY].sort());
    expect(provider.isKnown(RETIRED_KEY)).toBe(false);
  });

  it('uma instância nova (outro processo) lendo o banco com a role de runtime vê o mesmo', async () => {
    const fresh = new ExerciseCatalogProvider(app.get(TenantDatabase));
    await fresh.refresh();
    expect(
      fresh
        .getAll()
        .filter((e) => e.isFavorite)
        .map((e) => e.id)
        .sort(),
    ).toEqual([EVERYWHERE, GYM_ONLY].sort());
  });

  it('FULL_GYM: marcador só nas favoritas; favoritos antes de TODO não favorito, equipamento em 2º', async () => {
    const system = await systemPromptFor({ location: 'FULL_GYM' });
    const base = referenceBase(system);

    expect(base.filter((l) => l.favorite).map((l) => l.id)).toEqual([GYM_ONLY, EVERYWHERE]);
    // Revisão 2026-09-29: favorito é o critério PRIMÁRIO — favorito com equipamento >
    // favorito sem equipamento > não favorito com equipamento > resto. O favorito sem
    // equipamento vem antes de toda a faixa de não favoritos com equipamento.
    expect(base[0]).toMatchObject({ id: GYM_ONLY, favorite: true, equipped: true });
    expect(base[1]).toMatchObject({ id: EVERYWHERE, favorite: true, equipped: false });
    const rest = base.slice(2);
    expect(rest.some((l) => l.favorite)).toBe(false);
    // Entre os não favoritos, equipamento continua sendo o 2º critério.
    const firstBodyweight = rest.findIndex((l) => !l.equipped);
    expect(firstBodyweight).toBeGreaterThan(0);
    expect(rest.slice(0, firstBodyweight).every((l) => l.equipped)).toBe(true);
    expect(rest.slice(firstBodyweight).every((l) => !l.equipped)).toBe(true);
    expect(base.filter((l) => l.id === GYM_ONLY)).toHaveLength(1);

    const blockAt = system.indexOf(FAVORITE_BLOCK_HEADER);
    expect(blockAt).toBeGreaterThan(-1);
    expect(blockAt).toBeLessThan(system.indexOf('BASE DE REFERÊNCIA (use SOMENTE'));
  });

  it('CONDO_GYM: favorito sem equipamento lidera à frente da faixa com equipamento', async () => {
    const system = await systemPromptFor({ location: 'CONDO_GYM' });
    const base = referenceBase(system);

    expect(base.map((l) => l.id)).not.toContain(GYM_ONLY); // só serve FULL_GYM
    expect(base[0]).toMatchObject({ id: EVERYWHERE, favorite: true, equipped: false });
    expect(base[1]?.equipped).toBe(true);
    expect(system).toContain(FAVORITE_BLOCK_HEADER);
  });

  it('HOME: favorito só de academia não aparece; o que serve em casa lidera e mantém o bloco', async () => {
    const system = await systemPromptFor({ location: 'HOME' });
    const base = referenceBase(system);

    expect(base.map((l) => l.id)).not.toContain(GYM_ONLY);
    expect(system).not.toContain(GYM_ONLY);
    expect(base[0]).toMatchObject({ id: EVERYWHERE, favorite: true });
    expect(base.filter((l) => l.favorite)).toHaveLength(1);
    expect(system).toContain(FAVORITE_BLOCK_HEADER);
  });

  it('caso do fundador: só cadeira_flexora_maquina favoritada + aluno HOME → sem marcador e sem bloco', async () => {
    await setFavorites([GYM_ONLY]);
    const system = await systemPromptFor({ location: 'HOME' });

    expect(referenceBase(system).map((l) => l.id)).not.toContain(GYM_ONLY);
    expect(system).not.toContain(FAVORITE_MARKER);
    expect(system).not.toContain(FAVORITE_BLOCK_HEADER);
  });

  it('favorito contraindicado para o aluno (KNEE) some junto com o bloco', async () => {
    await setFavorites([GYM_ONLY, EVERYWHERE]);
    const system = await systemPromptFor({ location: 'FULL_GYM', injuryTags: ['KNEE'] });

    const ids = referenceBase(system).map((l) => l.id);
    expect(ids).not.toContain(GYM_ONLY);
    expect(ids).not.toContain(EVERYWHERE);
    expect(system).not.toContain(FAVORITE_BLOCK_HEADER);
  });

  it('sem nenhum favorito no banco: nenhuma linha marcada e bloco ausente', async () => {
    await setFavorites([]);
    expect(
      app
        .get(ExerciseCatalogProvider)
        .getAll()
        .some((e) => e.isFavorite),
    ).toBe(false);

    const system = await systemPromptFor({ location: 'FULL_GYM' });
    expect(system).not.toContain(FAVORITE_MARKER);
    expect(system).not.toContain(FAVORITE_BLOCK_HEADER);
  });
});

describe('Falha silenciosa — leitura de favoritos', () => {
  it('caminho feliz com a role real: NENHUM warn exercise_catalog_favorites_read_failed', () => {
    // Cobre o boot (`onModuleInit`) e todos os `invalidate()` disparados pelos endpoints acima.
    expect(favoriteReadFailures()).toEqual([]);
  });

  it('SELECT revogado da role de runtime: warn visível, snapshot ainda atualiza, sem favoritos', async () => {
    await setFavorites([EVERYWHERE]);
    const provider = app.get(ExerciseCatalogProvider);
    expect(provider.getById(EVERYWHERE)?.isFavorite).toBe(true);

    await migrator.unsafe(`REVOKE SELECT ON exercise_catalog_favorites FROM "${appRole}"`);
    try {
      await expect(provider.refresh()).resolves.toBeUndefined();
    } finally {
      await migrator.unsafe(`GRANT SELECT ON exercise_catalog_favorites TO "${appRole}"`);
    }

    const failures = favoriteReadFailures();
    expect(failures).toHaveLength(1);
    // O motivo real (não só "Failed query") precisa chegar ao log — ver `dbErrorFields`.
    expect(failures[0]?.[0]).toMatchObject({
      event: READ_FAILED_EVENT,
      err: expect.stringContaining('exercise_catalog_favorites'),
      cause: expect.stringContaining('permission denied for table exercise_catalog_favorites'),
      code: '42501',
    });
    // Degradação segura: catálogo inteiro continua servido, só sem a preferência.
    expect(provider.getAll().length).toBeGreaterThan(100);
    expect(provider.getAll().some((e) => e.isFavorite)).toBe(false);

    // Com a permissão de volta, o próximo refresh recupera o favorito.
    await provider.refresh();
    expect(provider.getById(EVERYWHERE)?.isFavorite).toBe(true);
    expect(favoriteReadFailures()).toHaveLength(1);
  });
});

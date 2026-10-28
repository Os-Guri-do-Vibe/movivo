import { migrationPostgresTls } from '../src/core/database/postgres-tls';
/**
 * Integração — favoritos do catálogo de exercícios (achado 2026-09-26, validação 2026-09-29).
 *
 * O fundador reportou em produção que favoritar "não funcionava" e que a IA não priorizava
 * favoritos. Toda a validação anterior do lado API era com `tx` mockado — nenhuma prova de
 * que, com a role de runtime `movivo_app` via PgBouncer, a linha é gravada, a auditoria
 * encadeada aceita o insert, o snapshot em memória do `ExerciseCatalogProvider` reflete a
 * mudança e o planejamento (seleção de candidatos de força) enxerga o favorito. Este arquivo prova isso por I/O
 * real, ponta a ponta:
 *
 *   1. HTTP real (`AppModule` inteiro, login Argon2id/RS256 de verdade) sobre
 *      `POST /control-center/ai/exercise-catalog/favorite|unfavorite` + `GET` do catálogo:
 *      gravação, idempotência, auditoria encadeada, RBAC (`AI_CONFIG_WRITE`), 400/404.
 *   2. Motor: a MESMA instância de `ExerciseCatalogProvider` injetada no planejamento enxerga o
 *      favorito logo após o endpoint (via `invalidate()`, sem esperar o timer de 5 min), e a
 *      seleção de candidatos do Motor (`selectStrengthCandidates`) o põe à frente dos demais do
 *      mesmo grupo — sem nunca oferecer favorito que o local ou uma limitação do aluno vetam.
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
import { ExerciseCatalogAdminService } from '../src/modules/admin/exercise-catalog-admin.service';
import { PasswordService } from '../src/modules/auth/password.service';
import { ExerciseCatalogProvider } from '../src/modules/catalog/exercises/exercise-catalog-provider.service';
import { selectStrengthCandidates } from '../src/modules/planning/inputs';
import { parseStateView } from '../src/modules/planning/state-view';

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
/** Publicado pelo código novo com `levels` não contíguo (2026-09-29). */
const LEVELS_KEY = `teste_niveis_${RUN}`;

const READ_FAILED_EVENT = 'exercise_catalog_favorites_read_failed';

// Migrador (dono das tabelas, BYPASSRLS): só setup/teardown e leitura de verificação.
const migrator = postgres({
  host: env.MIGRATION_DATABASE_HOST ?? 'localhost',
  ssl: migrationPostgresTls(env, env.MIGRATION_DATABASE_HOST ?? 'localhost'),
  port: Number(env.MIGRATION_DATABASE_PORT ?? process.env.HOST_POSTGRES_PORT ?? 15432),
  user: env.MIGRATION_DATABASE_USER ?? 'movivo_migrator',
  password: env.MIGRATION_DATABASE_PASSWORD,
  database: env.DATABASE_NAME ?? 'movivo',

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

/** Candidatos de força do Motor para um aluno que treina no `venue` e tem as dores `tags`. */
function candidatesFor(venue: 'FULL_GYM' | 'CONDO_GYM' | 'HOME', tags: string[] = []) {
  const view = parseStateView({
    training: { venues: [venue], modalities: [], externalSports: [] },
    safety: {
      activeSignals: [],
      healthRecords: tags.length ? [{ kind: 'PAIN', summary: 'dor', movementTags: tags }] : [],
    },
  });
  return selectStrengthCandidates(view, 'ADVANCED', app.get(ExerciseCatalogProvider).getAll())
    .candidates;
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

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
    await migrator`DELETE FROM exercise_catalog_entries WHERE exercise_key = ${LEVELS_KEY}`;
    await app?.get(ExerciseCatalogProvider).invalidate();
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

// 2026-09-29 (`levels`, seleção múltipla — migração 0062 aditiva): a escrita nova grava os
// dois campos (min_level = menor nível, para a API anterior seguir funcionando num rollback)
// e a leitura de linha sem `levels` (escrita pela API anterior) deriva de min_level.
describe('HTTP — níveis (levels) com role de runtime real', () => {
  it('publish grava `levels` e `min_level` = menor nível; GET e o snapshot devolvem `levels`', async () => {
    const res = await http()
      .post(url())
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        exerciseKey: LEVELS_KEY,
        changeNote: 'fixture de integração dos níveis',
        name: 'Teste Níveis',
        pattern: 'SQUAT',
        muscleGroups: ['quadríceps'],
        equipment: [],
        locations: ['HOME'],
        levels: ['AVANCADO', 'INICIANTE'],
        contraindicatedFor: [],
        substitutes: [],
      });
    expect(res.status).toBe(201);
    expect(
      (currentVersion(res.body, LEVELS_KEY) as unknown as { levels: string[] }).levels,
    ).toEqual(['AVANCADO', 'INICIANTE']);

    const [row] = await migrator<{ min_level: string; levels: string[] }[]>`
      SELECT min_level, levels FROM exercise_catalog_entries WHERE exercise_key = ${LEVELS_KEY}`;
    expect(row).toEqual({ min_level: 'INICIANTE', levels: ['AVANCADO', 'INICIANTE'] });
    expect(app.get(ExerciseCatalogProvider).getById(LEVELS_KEY)?.levels).toEqual([
      'AVANCADO',
      'INICIANTE',
    ]);
    // Fora do snapshot antes dos testes do motor abaixo (não mexe na base que eles leem).
    await migrator`DELETE FROM exercise_catalog_entries WHERE exercise_key = ${LEVELS_KEY}`;
    await app.get(ExerciseCatalogProvider).invalidate();
  });

  it('publish com `levels` vazio → 400 e nada é gravado', async () => {
    const res = await http()
      .post(url())
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        exerciseKey: `${LEVELS_KEY}_x`,
        changeNote: 'fixture de integração dos níveis',
        name: 'Teste Níveis Vazio',
        pattern: 'SQUAT',
        muscleGroups: ['quadríceps'],
        equipment: [],
        locations: ['HOME'],
        levels: [],
        contraindicatedFor: [],
        substitutes: [],
      });
    expect(res.status).toBe(400);
    const rows = await migrator`
      SELECT 1 FROM exercise_catalog_entries WHERE exercise_key = ${`${LEVELS_KEY}_x`}`;
    expect(rows).toHaveLength(0);
  });

  it('linha sem `levels` (escrita pela API anterior) sai no GET com `levels` derivado', async () => {
    const res = await http().get(url()).set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const retired = res.body.data.versions.filter(
      (v: CatalogVersion) => v.exerciseKey === RETIRED_KEY,
    ) as Array<{ levels: string[] }>;
    expect(retired).toHaveLength(2);
    for (const version of retired) {
      expect(version.levels).toEqual(['INICIANTE', 'INTERMEDIARIO', 'AVANCADO']);
    }
  });
});

describe('Motor — snapshot do ExerciseCatalogProvider e seleção de candidatos', () => {
  it('admin e planejamento compartilham a MESMA instância do provider (invalidate chega ao motor)', () => {
    const provider = app.get(ExerciseCatalogProvider);
    const viaAdmin = (app.get(ExerciseCatalogAdminService) as unknown as { catalog: unknown })
      .catalog;
    expect(viaAdmin).toBe(provider);
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

  it('FULL_GYM: o favorito lidera o seu grupo muscular e aparece uma única vez', async () => {
    const candidates = candidatesFor('FULL_GYM');
    const provider = app.get(ExerciseCatalogProvider);
    for (const key of [GYM_ONLY, EVERYWHERE]) {
      const group = provider.getById(key)?.muscleGroups[0];
      const inGroup = candidates.filter((c) => c.muscleGroups[0] === group);
      expect(inGroup.filter((c) => c.id === key)).toHaveLength(1);
      expect(inGroup[0]?.id).toBe(key);
    }
  });

  it('HOME: favorito só de academia não é oferecido; o que serve em casa continua à frente', async () => {
    const ids = candidatesFor('HOME').map((c) => c.id);
    expect(ids).not.toContain(GYM_ONLY);
  });

  it('favorito contraindicado para o aluno (KNEE) não é oferecido', async () => {
    await setFavorites([GYM_ONLY, EVERYWHERE]);
    const ids = candidatesFor('FULL_GYM', ['KNEE']).map((c) => c.id);
    expect(ids).not.toContain(GYM_ONLY);
    expect(ids).not.toContain(EVERYWHERE);
  });

  it('sem nenhum favorito no banco: nenhuma linha marcada', async () => {
    await setFavorites([]);
    expect(
      app
        .get(ExerciseCatalogProvider)
        .getAll()
        .some((e) => e.isFavorite),
    ).toBe(false);
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

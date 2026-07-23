/**
 * Teste-semente (a) — smoke de `GET /api/v1/health` (US-0.8 / TASK-0.8.3).
 *
 * Sobe o `AppModule` REAL contra o stack Docker (US-0.2) e prova, por I/O de verdade,
 * o contrato que Leonardo (US-0.3) deixou para este teste:
 *   · 200 com db.status = 'up' e redis.status = 'up';
 *   · db.port === 5433  → o runtime não regrediu para a 5432 direta (ARQUITETURA §12.3);
 *   · db.preparedStatements === false → PgBouncer transaction mode (ADR-003).
 *
 * Pré-requisito: `pnpm run infra:up`. Sem infra, o boot falha rápido — que é o
 * comportamento correto, não um flake.
 */
import 'reflect-metadata';

import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { AppConfigService } from '../src/core/config';

let app: INestApplication;
let prefix: string;

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  const config = app.get(AppConfigService);
  prefix = config.globalPrefix;
  app.setGlobalPrefix(prefix);
  await app.init();
});

afterAll(async () => {
  await app?.close();
});

describe('GET /health (smoke de integração)', () => {
  it('retorna 200 com Postgres e Redis reportando up', async () => {
    const res = await request(app.getHttpServer()).get(`/${prefix}/health`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.info.db.status).toBe('up');
    expect(res.body.info.redis.status).toBe('up');
  });

  it('prova via /health que a conexão vai pelo PgBouncer (5433) sem prepared statements', async () => {
    const res = await request(app.getHttpServer()).get(`/${prefix}/health`);

    expect(res.body.info.db.port).toBe(5433);
    expect(res.body.info.db.preparedStatements).toBe(false);
    expect(res.body.info.db.via).toBe('pgbouncer');
  });

  it('ecoa o x-correlation-id de entrada (rastreabilidade de log — LoggerModule)', async () => {
    const correlationId = 'test-corr-0f1e2d3c';
    const res = await request(app.getHttpServer())
      .get(`/${prefix}/health`)
      .set('x-correlation-id', correlationId);

    expect(res.headers['x-correlation-id']).toBe(correlationId);
  });
});

/**
 * Integração — ficha dos agentes: rascunho → teste → publicação, e a ficha publicada entra no
 * prompt das tarefas do agente. Pré-requisito: `pnpm run infra:up`, com `movivo-api` parado.
 */
import 'reflect-metadata';

import { BadRequestException, ConflictException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AGENT_PROFILE_STARTERS } from '@movivo/shared';

import { AppModule } from '../src/app.module';
import { PublishedAgentProfiles } from '../src/core/agents/agent-profile.reader';
import { agentProfiles, staff } from '../src/core/database/schema';
import { TenantDatabase } from '../src/core/database/tenant-database.service';
import { AgentProfilesService } from '../src/modules/agents-panel/agent-profiles.service';
import { EvaluationService } from '../src/modules/evaluation/evaluation.service';

let app: INestApplication;
let db: TenantDatabase;
let service: AgentProfilesService;
let staffId: string;
let base: string;
const created: string[] = [];

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  db = app.get(TenantDatabase);
  service = app.get(AgentProfilesService);
  const email = 'agent-profiles-admin@example.invalid';
  staffId = await db.runAsSystem(async (tx) => {
    const [existing] = await tx.select({ id: staff.id }).from(staff).where(eq(staff.email, email));
    if (existing) return existing.id;
    const [row] = await tx
      .insert(staff)
      .values({
        email,
        phoneNumber: `+5511${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        name: 'Teste fichas',
        passwordHash: 'x'.repeat(40),
        role: 'ADMIN',
      })
      .returning({ id: staff.id });
    if (!row) throw new Error('falha ao criar ADMIN de teste');
    return row.id;
  });
  const [published] = await db.runAsSystem((tx) =>
    tx
      .select({ content: agentProfiles.content })
      .from(agentProfiles)
      .where(and(eq(agentProfiles.agent, 'HYROX'), eq(agentProfiles.status, 'PUBLISHED'))),
  );
  base = published?.content ?? AGENT_PROFILE_STARTERS.HYROX;
});

afterAll(async () => {
  if (db && created.length > 0) {
    await db.runAsSystem((tx) =>
      tx.delete(agentProfiles).where(inArray(agentProfiles.id, created)),
    );
    app.get(PublishedAgentProfiles).invalidate();
  }
  await app?.close();
});

describe('ficha do agente', () => {
  it('rascunho → teste → publicação; a ficha publicada vai para o prompt do agente', async () => {
    const draft = await service.openDraft('HYROX', staffId);
    created.push(draft.id);
    expect(draft.content).toBe(base);
    expect((await service.openDraft('HYROX', staffId)).id).toBe(draft.id);

    await expect(
      service.updateDraft(draft.id, {
        content: `${base}\nFaço diagnóstico de lesões.`,
        changeNote: 'Teste de guardrail',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const content = `${base}\n- Estações com técnica limpa antes de ritmo de prova.`;
    await service.updateDraft(draft.id, { content, changeNote: 'Ênfase em técnica' });
    await expect(service.publish(draft.id, staffId)).rejects.toBeInstanceOf(ConflictException);

    const evaluate = vi.spyOn(app.get(EvaluationService), 'evaluate').mockResolvedValue({
      evalRunId: '00000000-0000-4000-8000-000000000000',
      taskId: 'hyrox.build_block',
      passed: true,
      casesTotal: 2,
      casesPassed: 2,
      costBrl: 0,
      results: [],
    });
    const tested = await service.test(draft.id, staffId);
    expect(tested.passed).toBe(true);
    expect(evaluate).toHaveBeenCalledWith(
      'hyrox.build_block',
      expect.objectContaining({
        profileOverride: { agent: 'HYROX', version: draft.version, content },
      }),
    );
    evaluate.mockRestore();

    const published = await service.publish(draft.id, staffId);
    expect(published.status).toBe('PUBLISHED');
    expect(await app.get(PublishedAgentProfiles).forTask('hyrox.build_block')).toMatchObject({
      agent: 'HYROX',
      version: draft.version,
      content,
    });

    const next = await service.openDraft('HYROX', staffId);
    created.push(next.id);
    expect(next.version).toBe(draft.version + 1);
    expect(next.content).toBe(content);
  });
});

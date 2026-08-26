/**
 * Validação de QA (Mariana, 2026-08-26) da feature "duas personas por slot" (Sprint 11)
 * contra infraestrutura REAL — Postgres via PgBouncer, Redis via Sentinel, Nest completo.
 *
 * O `persona-slot.int-spec.ts` do Leonardo cobre o banco (backfill + UNIQUE composto). Este
 * cobre o que só aparece exercitando o SERVIÇO real de ponta a ponta:
 *   1. empréstimo entre slots com a persona pré-existente (Leonardo, migrada para MALE);
 *   2. publicação real nos dois slots e independência da numeração de versão;
 *   3. isolamento do rollback por `(target_sex, version)`;
 *   4. roteamento por `users.biological_sex` até o SYSTEM PROMPT montado;
 *   5. neutralidade de gênero e ausência de linguagem clínica no prompt entregue;
 *   6. redação de PII do slot resolvido no log real do pino.
 *
 * Teardown: destrava a trigger de imutabilidade de `agent_config`/`audit_logs` e apaga TUDO
 * que foi criado, inclusive os snapshots do Redis — senão o slot FEMALE continuaria servindo
 * a persona de teste a partir do cache compartilhado depois do DELETE no banco.
 */
import 'reflect-metadata';

import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DEFAULT_AGENT_FORMATTING, type AgentPersona } from '@movivo/shared';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import pino from 'pino';
import postgres from 'postgres';
import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { AgentConfigRepository } from '../src/core/agent-config/agent-config.repository';
import { AgentPersonaService } from '../src/core/agent-config/agent-persona.service';
import { loadEnv } from '../src/core/config/load-env';
import { REDACT_PATHS, REDACTED } from '../src/core/logger/redaction.util';
import { AiConfigService } from '../src/modules/admin/ai-config.service';
import { PromptResolverService } from '../src/modules/ai-coach/intent/prompt-resolver.service';
import { ConversationRepository } from '../src/modules/coach/conversation.repository';
import { WhatsappOutboundWorker } from '../src/modules/whatsapp/whatsapp-outbound.worker';
import type { AuthenticatedUser } from '../src/modules/auth/jwt.strategy';

const { env } = loadEnv();
const RUN = Date.now().toString().slice(-8);

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

let app: INestApplication;
let aiConfig: AiConfigService;
let personaService: AgentPersonaService;
let repo: AgentConfigRepository;
let actor: AuthenticatedUser;
let maleStudentId = '';
let femaleStudentId = '';
let nullSexStudentId = '';

/** Estado pré-existente do slot MALE — precisa sobreviver a tudo que este teste faz. */
let baselineMale: { version: number; agentName: string } | null = null;

function persona(agentName: string, intro: string): AgentPersona {
  return {
    agentName,
    agentSelfIntro: intro,
    toneDescriptors: ['caloroso', 'direto'],
    personaTraits: ['ACOLHE_ANTES_DE_ORIENTAR', 'EXPLICA_O_PORQUE'],
    emojiPolicy: 'RARO',
    formatting: DEFAULT_AGENT_FORMATTING,
    humanHandoffMessage:
      'Entendi seu pedido e vou registrar para uma pessoa da equipe olhar com calma por aqui.',
  };
}

const FEMALE_V1 = persona('Marina', 'a coach digital da MOVIVO que acompanha o seu treino');
const FEMALE_V2 = persona('Beatriz', 'a coach digital da MOVIVO que acompanha o seu treino');
const MALE_NEW = persona('Rodrigo', 'o coach digital da MOVIVO que acompanha o seu treino');

beforeAll(async () => {
  const [admin] = await migrator<{ id: string }[]>`
    INSERT INTO users (phone_number, name, role, status)
    VALUES (${`+5562${RUN}00`}, ${`QA persona ${RUN}`}, 'ADMIN', 'ACTIVE')
    RETURNING id
  `;
  if (!admin) throw new Error('falha ao criar ADMIN de teste');
  actor = { userId: admin.id, role: 'ADMIN', jti: randomUUID() };

  const [male] = await migrator<{ id: string }[]>`
    INSERT INTO users (phone_number, name, role, status, biological_sex)
    VALUES (${`+5562${RUN}01`}, ${`Aluno M ${RUN}`}, 'USER', 'ACTIVE', 'MALE')
    RETURNING id
  `;
  const [female] = await migrator<{ id: string }[]>`
    INSERT INTO users (phone_number, name, role, status, biological_sex)
    VALUES (${`+5562${RUN}02`}, ${`Aluna F ${RUN}`}, 'USER', 'ACTIVE', 'FEMALE')
    RETURNING id
  `;
  const [nullSex] = await migrator<{ id: string }[]>`
    INSERT INTO users (phone_number, name, role, status)
    VALUES (${`+5562${RUN}03`}, ${`Aluno sem sexo ${RUN}`}, 'USER', 'ACTIVE')
    RETURNING id
  `;
  if (!male || !female || !nullSex) throw new Error('falha ao criar titulares de teste');
  maleStudentId = male.id;
  femaleStudentId = female.id;
  nullSexStudentId = nullSex.id;

  app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  aiConfig = app.get(AiConfigService);
  personaService = app.get(AgentPersonaService);
  repo = app.get(AgentConfigRepository);

  const active = await repo.activePayload('MALE');
  baselineMale = active
    ? {
        version: active.version,
        agentName: (active.payload as { agentName: string }).agentName,
      }
    : null;
}, 60_000);

afterAll(async () => {
  // Redis PRIMEIRO: o snapshot por slot sobrevive ao DELETE do banco e continuaria
  // sendo servido como persona vigente pela próxima instância que subir.
  try {
    const redis = new Redis({
      host: env.REDIS_HOST ?? 'localhost',
      port: Number(env.REDIS_PORT ?? 6379),
      password: env.REDIS_PASSWORD,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    await redis.connect();
    await redis.del(personaService.cacheKeyFor('MALE'), personaService.cacheKeyFor('FEMALE'));
    await redis.quit();
  } catch {
    /* o teste não falha por não conseguir limpar o cache — o DELETE abaixo é a verdade. */
  }

  await app?.close();

  await migrator`ALTER TABLE agent_config DISABLE TRIGGER USER`;
  await migrator`DELETE FROM agent_config WHERE created_by = ${actor.userId}::uuid`;
  await migrator`ALTER TABLE agent_config ENABLE TRIGGER USER`;

  await migrator`ALTER TABLE audit_logs DISABLE TRIGGER trg_audit_logs_immutable`;
  await migrator`DELETE FROM audit_logs WHERE actor_id = ${actor.userId}::uuid
    OR user_id IN (${actor.userId}::uuid, ${maleStudentId}::uuid, ${femaleStudentId}::uuid,
                   ${nullSexStudentId}::uuid)`;
  await migrator`ALTER TABLE audit_logs ENABLE TRIGGER trg_audit_logs_immutable`;

  await migrator`DELETE FROM users WHERE id IN (${actor.userId}::uuid, ${maleStudentId}::uuid,
    ${femaleStudentId}::uuid, ${nullSexStudentId}::uuid)`;
  await migrator.end({ timeout: 5 });
}, 60_000);

describe('1. estado inicial — empréstimo do slot órfão', () => {
  it('a persona pré-existente foi preservada no slot MALE pela migração 0036', async () => {
    expect(baselineMale).not.toBeNull();
    const rows = await migrator<{ n: number }[]>`
      SELECT count(*)::int AS n FROM agent_config
      WHERE target_sex = 'MALE' AND status = 'PUBLISHED'
    `;
    expect(rows[0]?.n).toBeGreaterThan(0);
  });

  it('FEMALE sem publicação é atendido pela persona de MALE, com servedFromSex divergente', async () => {
    const resolved = await personaService.resolve('FEMALE');
    expect(resolved.servedFromSex).toBe('MALE');
    expect(resolved.persona.agentName).toBe(baselineMale?.agentName);

    const response = await aiConfig.persona('FEMALE');
    expect(response.data.servedFromSex).toBe('MALE');
    expect(response.data.targetSex).toBe('FEMALE');
    expect(response.meta.dataQuality.join(' ')).toContain('Ainda não há persona publicada');
  });
});

describe('2. publicação real nos dois slots', () => {
  it('publicar FEMALE não toca no slot MALE e encerra o empréstimo', async () => {
    const published = await aiConfig.publish(actor, {
      targetSex: 'FEMALE',
      payload: FEMALE_V1,
      changeNote: 'QA Mariana — primeira persona feminina',
    });
    expect(published.data.targetSex).toBe('FEMALE');
    expect(published.data.servedFromSex).toBe('FEMALE');
    expect(published.meta.dataQuality.join(' ')).toContain('primeiro texto publicado');

    const female = await personaService.resolve('FEMALE');
    expect(female.servedFromSex).toBe('FEMALE');
    expect(female.persona.agentName).toBe('Marina');

    const male = await personaService.resolve('MALE');
    expect(male.servedFromSex).toBe('MALE');
    expect(male.persona.agentName).toBe(baselineMale?.agentName);
    expect((await repo.activePayload('MALE'))?.version).toBe(baselineMale?.version);
  });

  it('a numeração de versão é independente por slot', async () => {
    const beforeMale = (await repo.activePayload('MALE'))?.version ?? 0;
    const beforeFemale = (await repo.activePayload('FEMALE'))?.version ?? 0;

    await aiConfig.publish(actor, {
      targetSex: 'MALE',
      payload: MALE_NEW,
      changeNote: 'QA Mariana — nova persona masculina',
    });

    const afterMale = (await repo.activePayload('MALE'))?.version ?? 0;
    const afterFemale = (await repo.activePayload('FEMALE'))?.version ?? 0;
    expect(afterMale).toBeGreaterThan(beforeMale);
    // O avanço de MALE não move FEMALE — as duas linhas do tempo são independentes.
    expect(afterFemale).toBe(beforeFemale);

    const femaleHistory = await aiConfig.history('FEMALE');
    const maleHistory = await aiConfig.history('MALE');
    expect(femaleHistory.data.versions.every((v) => v.targetSex === 'FEMALE')).toBe(true);
    expect(maleHistory.data.versions.every((v) => v.targetSex === 'MALE')).toBe(true);
    // O histórico de um slot nunca oferece para rollback uma versão do outro.
    expect(femaleHistory.data.versions.some((v) => v.payload.agentName === 'Rodrigo')).toBe(false);
    expect(maleHistory.data.versions.some((v) => v.payload.agentName === 'Marina')).toBe(false);
  });
});

describe('3. rollback isolado por slot', () => {
  it('rollback em FEMALE para a versão N não altera a persona vigente de MALE', async () => {
    const marinaVersion = (await repo.activePayload('FEMALE'))?.version;
    if (marinaVersion === undefined) throw new Error('FEMALE deveria estar publicado');

    await aiConfig.publish(actor, {
      targetSex: 'FEMALE',
      payload: FEMALE_V2,
      changeNote: 'QA Mariana — segunda persona feminina',
    });
    expect((await personaService.resolve('FEMALE')).persona.agentName).toBe('Beatriz');

    const maleBefore = await repo.activePayload('MALE');

    await aiConfig.rollback(actor, {
      targetSex: 'FEMALE',
      targetVersion: marinaVersion,
      changeNote: 'QA Mariana — rollback isolado por slot',
    });

    // FEMALE voltou a Marina…
    expect((await personaService.resolve('FEMALE')).persona.agentName).toBe('Marina');
    // …e MALE não se moveu nem um número de versão.
    const maleAfter = await repo.activePayload('MALE');
    expect(maleAfter?.version).toBe(maleBefore?.version);
    expect((maleAfter?.payload as { agentName: string }).agentName).toBe('Rodrigo');
  });

  it('rollback recusa versão que existe apenas no OUTRO slot', async () => {
    // Versão que existe SÓ em MALE. Semeada direto no banco para ser determinística:
    // `publish()` numera por `max(version)+1` do slot e pode dar o mesmo número aos dois.
    const onlyMale = 880_000 + Number(RUN.slice(-4));
    await migrator`
      INSERT INTO agent_config (target_sex, version, status, payload, change_note, created_by)
      VALUES ('MALE', ${onlyMale}, 'PUBLISHED', ${migrator.json(MALE_NEW)},
              'QA Mariana — versão só do slot MALE', ${actor.userId}::uuid)
    `;
    await expect(
      aiConfig.rollback(actor, {
        targetSex: 'FEMALE',
        targetVersion: onlyMale,
        changeNote: 'QA Mariana — versão inexistente neste slot',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('com a MESMA version nos dois slots, o rollback reverte o payload do slot pedido', async () => {
    // Precondição do bug que a mudança diz evitar: `version = V` existe nos dois slots,
    // com payloads diferentes e sem relação nenhuma entre si.
    // Acima do maior `version` já existente nos DOIS slots, para que as linhas semeadas
    // sejam de fato as vigentes (a vigente é `max(version)` com `status = 'PUBLISHED'`).
    const [top] = await migrator<{ max: number }[]>`
      SELECT coalesce(max(version), 0)::int AS max FROM agent_config
    `;
    const shared = (top?.max ?? 0) + 1_000;
    const intrusoMale = persona('Intruso', 'o coach digital da MOVIVO que acompanha o treino');
    const alvoFemale = persona('Alvo', 'a coach digital da MOVIVO que acompanha o seu treino');
    await migrator`
      INSERT INTO agent_config (target_sex, version, status, payload, change_note, created_by)
      VALUES ('MALE', ${shared}, 'PUBLISHED', ${migrator.json(intrusoMale)},
              'QA Mariana — colisão de version, lado MALE', ${actor.userId}::uuid),
             ('FEMALE', ${shared}, 'PUBLISHED', ${migrator.json(alvoFemale)},
              'QA Mariana — colisão de version, lado FEMALE', ${actor.userId}::uuid)
    `;
    personaService.invalidate();

    await aiConfig.rollback(actor, {
      targetSex: 'FEMALE',
      targetVersion: shared,
      changeNote: 'QA Mariana — rollback na version que colide entre slots',
    });

    // Reverteu para o payload FEMALE daquela version, nunca para o homônimo de MALE.
    expect((await personaService.resolve('FEMALE')).persona.agentName).toBe('Alvo');

    // MALE é conferido no BANCO (fonte de verdade), não pelo resolver: as linhas acima
    // foram semeadas por SQL direto e portanto não passaram por `propagate()`, então o
    // snapshot Redis do slot MALE ainda tem o payload da última publicação via serviço.
    const maleActive = await repo.activePayload('MALE');
    expect((maleActive?.payload as { agentName: string }).agentName).toBe('Intruso');
    // O rollback de FEMALE não inseriu versão nenhuma no slot MALE.
    expect(maleActive?.version).toBe(shared);
  });
});

describe('4. roteamento por sexo biológico até o system prompt', () => {
  it('cada titular recebe o prompt da persona do seu slot', async () => {
    const conversation = app.get(ConversationRepository);
    const prompts = app.get(PromptResolverService);

    // Republica um par conhecido: os testes de rollback acima deixaram outros nomes vigentes.
    await aiConfig.publish(actor, {
      targetSex: 'MALE',
      payload: MALE_NEW,
      changeNote: 'QA Mariana — baseline do teste de roteamento (MALE)',
    });
    await aiConfig.publish(actor, {
      targetSex: 'FEMALE',
      payload: FEMALE_V1,
      changeNote: 'QA Mariana — baseline do teste de roteamento (FEMALE)',
    });

    const male = await conversation.loadRuntimeUser(maleStudentId);
    const female = await conversation.loadRuntimeUser(femaleStudentId);
    expect(male.biologicalSex).toBe('MALE');
    expect(female.biologicalSex).toBe('FEMALE');

    const malePersona = await prompts.persona(male.biologicalSex);
    const femalePersona = await prompts.persona(female.biologicalSex);
    const malePrompt = await prompts.resolvePromptFor('DUVIDA_TECNICA', malePersona);
    const femalePrompt = await prompts.resolvePromptFor('DUVIDA_TECNICA', femalePersona);

    expect(malePrompt).toContain('Você é Rodrigo.');
    expect(malePrompt).not.toContain('Marina');
    expect(femalePrompt).toContain('Você é Marina.');
    expect(femalePrompt).not.toContain('Rodrigo');

    // A superfície fora do prompt (WhatsApp, transcrição) usa o mesmo slot.
    expect(await personaService.agentName('MALE')).toBe('Rodrigo');
    expect(await personaService.agentName('FEMALE')).toBe('Marina');
  });

  it('o worker de WhatsApp monta a mensagem de espera com a persona do slot do titular', async () => {
    // Caminho REAL do outbound: `buildWaiting` lê `users.biological_sex` dentro da mesma
    // transação sob RLS e resolve a persona daquele slot antes de montar a copy.
    const worker = app.get(WhatsappOutboundWorker) as unknown as {
      buildWaiting: (userId: string | null) => Promise<string | null>;
    };

    const maleText = await worker.buildWaiting(maleStudentId);
    const femaleText = await worker.buildWaiting(femaleStudentId);

    expect(maleText).toContain('Rodrigo');
    expect(maleText).not.toContain('Marina');
    expect(femaleText).toContain('Marina');
    expect(femaleText).not.toContain('Rodrigo');
    // Guardrail de marca: a copy entregue nunca promete resultado nem usa termo clínico.
    for (const text of [maleText, femaleText]) {
      expect(text?.toLowerCase()).not.toMatch(/diagn[óo]stico|tratamento|resultado\s+garantid/);
    }
  });

  it('titular sem biological_sex não quebra: cai no slot padrão sem persona vazia', async () => {
    const conversation = app.get(ConversationRepository);
    const { biologicalSex } = await conversation.loadRuntimeUser(nullSexStudentId);
    expect(biologicalSex).toBeNull();

    const resolved = await personaService.resolve(biologicalSex);
    expect(resolved.persona.agentName).toBeTruthy();
    expect(resolved.servedFromSex).not.toBeNull();
  });
});

describe('5. neutralidade de gênero e linguagem clínica no prompt entregue', () => {
  const CLINICAL = ['diagnóstic', 'tratamento', 'cura ', 'resultado garantido'];
  // Adjetivos flexionados no feminino que o TONE_LABEL antigo injetava — a regressão
  // exata que quebrava a concordância de uma persona de nome masculino.
  const GENDERED = ['calorosa', 'direta', 'bem-humorada', 'técnica', 'caloroso,', 'direto,'];

  it('nenhuma das duas personas carrega adjetivo de tom flexionado nem termo clínico vedado', async () => {
    const prompts = app.get(PromptResolverService);
    for (const slot of ['MALE', 'FEMALE'] as const) {
      const p = await prompts.persona(slot);
      for (const intent of ['DUVIDA_TECNICA', 'MOTIVACAO', 'SAUDACAO'] as const) {
        const full = (await prompts.resolvePromptFor(intent, p)).toLowerCase();
        // Só o bloco L2 (persona) vem do painel; os blocos L0/L1 são constantes de código
        // que legitimamente CITAM os termos vedados ("nunca use 'diagnóstico'…") e usam
        // "orientação médica direta" — adjetivo que concorda com "orientação", não com a
        // agente. Comparar o prompt inteiro mediria o texto errado.
        const personaBlock = full.split('formato da mensagem')[0] ?? '';
        for (const term of CLINICAL) expect(personaBlock).not.toContain(term);
        for (const term of GENDERED) expect(personaBlock).not.toContain(term);
      }
      // O tom sai como SUBSTANTIVO nos dois slots.
      expect(await prompts.resolvePromptFor('DUVIDA_TECNICA', p)).toContain(
        'Seu tom é: acolhimento, objetividade',
      );
    }
  });

  it('a mensagem de handoff entregue ao aluno preserva o selo CREF nos dois slots', async () => {
    const prompts = app.get(PromptResolverService);
    for (const slot of ['MALE', 'FEMALE'] as const) {
      const text = prompts.humanHandoffMessageFor(await prompts.persona(slot));
      expect(text).toContain('profissional de Educação Física');
      expect(text.toLowerCase()).not.toContain('diagnóstic');
      expect(text.toLowerCase()).not.toContain('garantido');
    }
  });
});

describe('6. redação de PII do slot resolvido no log real', () => {
  /** Captura NDJSON de um pino configurado exatamente como o da aplicação. */
  function capture(): { log: pino.Logger; lines: string[] } {
    const lines: string[] = [];
    const stream = new PassThrough();
    stream.on('data', (chunk: Buffer) => lines.push(chunk.toString()));
    const log = pino({ redact: { paths: [...REDACT_PATHS], censor: REDACTED } }, stream);
    return { log, lines };
  }

  it('personaSlot (LlmRouter) sai redigido', async () => {
    const { log, lines } = capture();
    log.info({ event: 'llm_usage', userId: femaleStudentId, personaSlot: 'FEMALE' }, 'uso');
    await new Promise((r) => setImmediate(r));
    expect(lines.join('')).not.toContain('FEMALE');
    expect(lines.join('')).toContain(REDACTED);
  });

  it('o log de empréstimo do AgentPersonaService sai redigido', async () => {
    // Captura o objeto REALMENTE emitido em runtime: instancia o serviço com um PinoLogger
    // espião e força o caminho de empréstimo (slot pedido sem publicação própria).
    const emitted: Record<string, unknown>[] = [];
    const spy = {
      setContext: () => undefined,
      info: (obj: Record<string, unknown>) => emitted.push(obj),
      warn: (obj: Record<string, unknown>) => emitted.push(obj),
    };
    const fakeRedis = {
      get: async () => null,
      duplicate: () => ({
        subscribe: async () => undefined,
        on: () => undefined,
        quit: async () => undefined,
      }),
    };
    const orphanRepo = {
      activePayload: async (slot: string) =>
        slot === 'MALE' ? { version: 1, payload: FEMALE_V1 } : null,
    };
    const service = new AgentPersonaService(
      orphanRepo as never,
      fakeRedis as never,
      app.get(AgentPersonaService)['keys'] as never,
      spy as never,
    );
    const resolved = await service.resolve('FEMALE');
    expect(resolved.servedFromSex).toBe('MALE');

    const fallback = emitted.find((e) => e.event === 'agent_config_fallback');
    expect(fallback).toBeDefined();

    // Passa o objeto real por um pino com a MESMA configuração de redação da aplicação.
    const { log, lines } = capture();
    log.info({ userId: femaleStudentId, ...fallback }, 'empréstimo');
    await new Promise((r) => setImmediate(r));
    const output = lines.join('');

    // O slot do titular não pode sair em claro num log que carrega `userId`.
    expect(output).not.toContain('"slot":"FEMALE"');
    expect(output).not.toContain('"borrowedFrom":"MALE"');
  });

  it('REDACT_PATHS cobre os nomes de campo realmente emitidos pelo empréstimo', () => {
    // Checagem direta sobre a constante exportada que a aplicação usa, sem log intermediário.
    // Correção adotada: renomear os campos emitidos (`slot`→`personaSlot`,
    // `borrowedFrom`→`borrowedFromSlot`) em vez de alargar a lista com nomes genéricos —
    // `slot`/`borrowedFrom` cru redigiria qualquer log da aplicação que use essas palavras
    // para outra coisa (agenda, fila). Ver `agent-persona.service.ts`.
    for (const field of ['personaSlot', 'borrowedFromSlot']) {
      expect(REDACT_PATHS).toContain(field);
    }
  });
});

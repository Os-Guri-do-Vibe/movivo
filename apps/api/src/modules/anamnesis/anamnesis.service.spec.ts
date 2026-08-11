/**
 * Unitários do `AnamnesisService` — onboarding v2 (Sprint 6).
 *
 * Complementam `test/anamnesis.int-spec.ts` (que prova o comportamento contra o banco
 * real: RLS por sessão, cifra, migração). Aqui ficam as **travas** que não dependem de
 * I/O e que a US-6.12 declara bloqueantes: gate 18+ no servidor, consentimentos
 * obrigatórios, posse do número, consentimento de saúde reavaliado na coleta, gate
 * PAR-Q e a ausência de vazamento de dado clínico na resposta.
 */
import {
  PARQ_DECLARATIONS,
  PARQ_DECLARATIONS_VERSION,
  PARQ_QUESTION_IDS,
  PARQ_VERSION,
  UNDER_AGE_MESSAGE,
} from '@movivo/shared';
import { describe, expect, it, vi } from 'vitest';

import { type HealthCipherService, type TenantDatabase } from '../../core/database';
import { type QueueManager } from '../jobs/queue-manager.service';
import { AnamnesisService } from './anamnesis.service';
import { type ConsentService } from './consent.service';
import { type PhoneVerificationService } from './phone-verification.service';

const HOUR = 3600_000;
const future = () => new Date(Date.now() + 72 * HOUR);
const past = () => new Date(Date.now() - HOUR);
const PHONE = '+5511999998888';

function parq(risky = false) {
  return {
    version: PARQ_VERSION,
    answers: PARQ_QUESTION_IDS.map((questionId, i) => ({
      questionId,
      answer: risky && i === 0,
    })),
  };
}

const STEP1 = {
  name: 'Fulano de Teste',
  birthDate: '1996-04-02',
  biologicalSex: 'MALE' as const,
  phoneNumber: PHONE,
};

const STRUCTURED = {
  primaryGoal: 'GAIN_STRENGTH' as const,
  emphasis: ['BACK' as const],
  hasImportantEvent: false,
  trainingStatus: 'REGULAR' as const,
  experience: 'INTERMEDIATE' as const,
  pastActivities: [],
  consistencyBarriers: [],
  daysPerWeek: 4,
  preferredDays: [],
  sessionDuration: 'M45_TO_60' as const,
  location: 'CONDO_GYM' as const,
  preferredPeriod: 'MORNING' as const,
  practicesOtherSport: false,
  hasAvoidedExercise: false,
};

const STEP2 = {
  anamnesis: { structured: STRUCTURED, freeText: {} },
  pain: { hasPain: false, points: [] },
};

const STEP3 = {
  parq: parq(),
  declarationsVersion: PARQ_DECLARATIONS_VERSION,
  declarations: PARQ_DECLARATIONS.map((d) => d.id),
};

const HEALTH_BLOCK = (risky = false) => ({
  pain: { hasPain: false, points: [] },
  freeText: {},
  parq: parq(risky),
  declarations: {
    version: PARQ_DECLARATIONS_VERSION,
    accepted: PARQ_DECLARATIONS.map((d) => d.id),
    acceptedAt: new Date().toISOString(),
  },
});

interface TxState {
  select?: unknown[];
  insert?: unknown[];
  update?: unknown[];
  insertError?: unknown;
}

function makeTx(state: TxState) {
  const thenable = (rows: unknown[]) => ({
    returning: () => Promise.resolve(rows),
    then: (r: (v: unknown) => unknown) => r(rows),
  });
  const insertThenable = state.insertError
    ? {
        returning: () => Promise.reject(state.insertError),
        then: () => Promise.reject(state.insertError),
      }
    : thenable(state.insert ?? []);
  const selectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: () => Promise.resolve(state.select ?? []),
  };
  return {
    select: () => selectChain,
    insert: () => ({ values: () => insertThenable }),
    update: () => ({ set: () => ({ where: () => thenable(state.update ?? []) }) }),
    execute: () => Promise.resolve([]),
  } as never;
}

function makeService(state: TxState = {}) {
  const run = vi.fn((cb: (tx: unknown) => Promise<unknown>) => cb(makeTx(state)));
  const runScoped = vi.fn((_id: string, cb: (tx: unknown) => Promise<unknown>) =>
    cb(makeTx(state)),
  );
  const db = {
    runAsToken: run,
    runAsTokenScoped: runScoped,
    runAsSystem: run,
  } as unknown as TenantDatabase;

  const cipher = {
    encryptHealth: vi.fn(() => Promise.resolve(Buffer.from('cipher'))),
    decryptHealth: vi.fn(() => Promise.resolve(JSON.stringify(HEALTH_BLOCK(false)))),
  } as unknown as HealthCipherService;

  const consents = {
    hasValidHealthConsent: vi.fn(() => Promise.resolve(true)),
    acceptedTypesForSession: vi.fn(() =>
      Promise.resolve(['TERMS_OF_SERVICE', 'HEALTH_DATA', 'AI_DISCLOSURE']),
    ),
    linkSessionToUser: vi.fn(() => Promise.resolve()),
  } as unknown as ConsentService;

  const phone = {
    sendCode: vi.fn(() => Promise.resolve({ sent: true })),
    verify: vi.fn(() => Promise.resolve()),
  } as unknown as PhoneVerificationService;

  const logger = { info: vi.fn(), warn: vi.fn(), setContext: vi.fn() } as never;
  const queues = { enqueue: vi.fn(() => Promise.resolve('job-1')) } as unknown as QueueManager;
  return {
    svc: new AnamnesisService(logger, db, cipher, consents, queues, phone),
    cipher,
    consents,
    phone,
    queues,
  };
}

/** Linha de sessão IN_PROGRESS com número já verificado (ajustável por override). */
function sessionRow(over: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    token: 't'.repeat(64),
    status: 'IN_PROGRESS',
    lastStep: 1,
    primaryGoal: null,
    parqState: null,
    dataBlock1: STEP1,
    dataBlock2: Buffer.from('cipher'),
    dataBlock3: STRUCTURED,
    phoneE164: PHONE,
    phoneVerifiedAt: new Date(),
    phoneCodeHash: null,
    phoneCodeExpiresAt: null,
    phoneCodeAttempts: 0,
    phoneCodeSentAt: null,
    phoneCodeSendCount: 0,
    expiresAt: future(),
    ...over,
  };
}

describe('AnamnesisService — sessão e retomada', () => {
  it('start gera token CSPRNG de 64 hex e TTL de 72h', async () => {
    const { svc } = makeService();
    const res = await svc.start({});
    expect(res.token).toMatch(/^[0-9a-f]{64}$/);
    expect(res.currentStep).toBe(1);
    expect(res.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('getByToken lança 404 quando o token não existe', async () => {
    const { svc } = makeService({ select: [] });
    await expect(svc.getByToken('nope')).rejects.toThrow(/não encontrada/i);
  });

  it('retoma na etapa certa, entrega os consentimentos e NÃO expõe o bloco de saúde', async () => {
    const { svc } = makeService({ select: [sessionRow({ lastStep: 2 })] });
    const view = await svc.getByToken('t');
    expect(view.status).toBe('IN_PROGRESS');
    expect(view.currentStep).toBe(2);
    expect(view.phoneVerified).toBe(true);
    expect(view.healthCompleted).toBe(true);
    // Nenhuma resposta de saúde na projeção — só o fato de a etapa ter sido preenchida.
    // (o texto do consentimento cita "PAR-Q", então a asserção mira o CONTEÚDO: respostas.)
    expect(JSON.stringify(view)).not.toMatch(/questionId|answers|hasPain/);
    // Consentimentos vêm do backend, com texto e versão (Sofia §2.3) e nunca marcados.
    expect(view.consents.map((c) => c.type)).toEqual([
      'TERMS_OF_SERVICE',
      'HEALTH_DATA',
      'AI_DISCLOSURE',
      'MARKETING',
    ]);
    expect(view.consents.every((c) => c.version.length > 0)).toBe(true);
  });

  it('expira em voo e descarta o bloco de saúde da resposta', async () => {
    const { svc } = makeService({ select: [sessionRow({ expiresAt: past() })] });
    const view = await svc.getByToken('t');
    expect(view.status).toBe('EXPIRED');
    expect(view.healthCompleted).toBe(false);
  });
});

describe('Etapa 1 — gate 18+, consentimentos e posse do número', () => {
  it('barra menor de 18 NO SERVIDOR com a mensagem exata do fundador', async () => {
    const { svc } = makeService({ select: [sessionRow()] });
    await expect(svc.patchStep('t', 1, { ...STEP1, birthDate: '2015-01-01' })).rejects.toThrow(
      UNDER_AGE_MESSAGE,
    );
  });

  it('aceita quem faz 18 anos exatamente hoje', async () => {
    const { svc } = makeService({ select: [sessionRow()] });
    const today = new Date();
    const birthDate = `${today.getUTCFullYear() - 18}-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;
    await expect(svc.patchStep('t', 1, { ...STEP1, birthDate })).resolves.toEqual({
      currentStep: 2,
    });
  });

  it('recusa a etapa 1 sem os consentimentos obrigatórios', async () => {
    const { svc, consents } = makeService({ select: [sessionRow()] });
    (consents.acceptedTypesForSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      'TERMS_OF_SERVICE',
    ]);
    await expect(svc.patchStep('t', 1, STEP1)).rejects.toThrow(/obrigatórios pendentes/i);
  });

  it('recusa a etapa 1 sem o número verificado', async () => {
    const { svc } = makeService({ select: [sessionRow({ phoneVerifiedAt: null })] });
    await expect(svc.patchStep('t', 1, STEP1)).rejects.toThrow(/código enviado no WhatsApp/i);
  });

  it('recusa quando o número enviado difere do número verificado', async () => {
    const { svc } = makeService({ select: [sessionRow({ phoneE164: '+5511900000000' })] });
    await expect(svc.patchStep('t', 1, STEP1)).rejects.toThrow(/código enviado no WhatsApp/i);
  });

  it('persiste a etapa 1 sem cifrar (dado pessoal comum)', async () => {
    const { svc, cipher } = makeService({ select: [sessionRow()] });
    await svc.patchStep('t', 1, STEP1);
    expect(cipher.encryptHealth).not.toHaveBeenCalled();
  });

  it('lança 410 em sessão expirada', async () => {
    const { svc } = makeService({ select: [sessionRow({ expiresAt: past() })] });
    await expect(svc.patchStep('t', 1, STEP1)).rejects.toThrow(/expirada/i);
  });
});

describe('Etapa 2 — seção 4 cifrada e gated por consentimento de saúde', () => {
  it('recusa a coleta sem consentimento de saúde vigente', async () => {
    const { svc, consents } = makeService({ select: [sessionRow()] });
    (consents.hasValidHealthConsent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    await expect(svc.patchStep('t', 2, STEP2)).rejects.toThrow(/consentimento de saúde/i);
  });

  it('reavalia o consentimento NA COLETA, mesmo com a etapa 1 concluída', async () => {
    const { svc, consents } = makeService({ select: [sessionRow({ lastStep: 3 })] });
    (consents.hasValidHealthConsent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    await expect(svc.patchStep('t', 2, STEP2)).rejects.toThrow(/consentimento de saúde/i);
  });

  it('cifra a seção 4 e o texto livre; as seções comuns vão em claro', async () => {
    const { svc, cipher } = makeService({ select: [sessionRow()] });
    const res = await svc.patchStep('t', 2, {
      anamnesis: {
        structured: { ...STRUCTURED, hasAvoidedExercise: true },
        freeText: { avoidedExercise: 'burpee' },
      },
      pain: { hasPain: true, trend: 'STABLE', points: [{ region: 'KNEE', intensity: 6 }] },
    });
    expect(cipher.encryptHealth).toHaveBeenCalled();
    const encrypted = (cipher.encryptHealth as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string;
    expect(encrypted).toContain('KNEE');
    expect(encrypted).toContain('burpee');
    expect(res.currentStep).toBe(3);
  });

  it('recusa payload que viola a regra de exclusividade de "corpo todo"', async () => {
    const { svc } = makeService({ select: [sessionRow()] });
    await expect(
      svc.patchStep('t', 2, {
        ...STEP2,
        anamnesis: {
          structured: { ...STRUCTURED, emphasis: ['FULL_BODY', 'CHEST'] },
          freeText: {},
        },
      }),
    ).rejects.toThrow();
  });
});

describe('Etapa 3 — PAR-Q e declarações', () => {
  it('recusa o fechamento sem as 3 declarações', async () => {
    const { svc } = makeService({ select: [sessionRow()] });
    await expect(svc.patchStep('t', 3, { ...STEP3, declarations: ['TRUTHFUL'] })).rejects.toThrow();
  });

  it('recusa o PAR-Q sem consentimento de saúde', async () => {
    const { svc, consents } = makeService({ select: [sessionRow()] });
    (consents.hasValidHealthConsent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    await expect(svc.patchStep('t', 3, STEP3)).rejects.toThrow(/consentimento de saúde/i);
  });

  it('cifra o PAR-Q e as declarações', async () => {
    const { svc, cipher } = makeService({ select: [sessionRow()] });
    await svc.patchStep('t', 3, STEP3);
    const encrypted = (cipher.encryptHealth as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string;
    expect(encrypted).toContain(PARQ_VERSION);
    expect(encrypted).toContain('MAY_REQUIRE_REVIEW');
  });
});

describe('Submit — gate PAR-Q e outcome', () => {
  it('exige as três etapas preenchidas', async () => {
    const { svc } = makeService({ select: [sessionRow({ dataBlock3: null })] });
    await expect(svc.submit('t')).rejects.toThrow(/complete as três etapas/i);
  });

  it('PAR-Q limpo devolve READY e nada além disso', async () => {
    const { svc, consents } = makeService({ select: [sessionRow()], insert: [{ id: 'user-1' }] });
    const res = await svc.submit('t');
    expect(res).toEqual({ status: 'SUBMITTED', outcome: 'READY' });
    expect(consents.linkSessionToUser).toHaveBeenCalledWith('sess-1', 'user-1');
  });

  it('PAR-Q com "Sim" devolve PENDING_REVIEW e NUNCA o motivo', async () => {
    const { svc, cipher } = makeService({ select: [sessionRow()], insert: [{ id: 'user-2' }] });
    (cipher.decryptHealth as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify(HEALTH_BLOCK(true)),
    );
    const res = await svc.submit('t');
    expect(res.outcome).toBe('PENDING_REVIEW');
    // Nada de resposta do PAR-Q, id de pergunta ou estado clínico volta ao cliente.
    expect(JSON.stringify(res)).not.toMatch(/Q[1-9]|BLOQUEADO|parq/i);
  });

  it('recusa o submit sem o número verificado', async () => {
    const { svc } = makeService({ select: [sessionRow({ phoneVerifiedAt: null })] });
    await expect(svc.submit('t')).rejects.toThrow(/código enviado no WhatsApp/i);
  });

  it('recusa o submit se o consentimento de saúde foi revogado no meio do funil', async () => {
    const { svc, consents } = makeService({ select: [sessionRow()] });
    (consents.hasValidHealthConsent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    await expect(svc.submit('t')).rejects.toThrow(/consentimento de saúde/i);
  });

  it('lança 409 quando a sessão já foi enviada', async () => {
    const { svc } = makeService({ select: [sessionRow({ status: 'SUBMITTED' })] });
    await expect(svc.submit('t')).rejects.toThrow(/já foi enviada/i);
  });

  it('traduz unique_violation (telefone/e-mail já cadastrado) em 409', async () => {
    const { svc } = makeService({
      select: [sessionRow()],
      insertError: Object.assign(new Error('dup'), { code: '23505' }),
    });
    await expect(svc.submit('t')).rejects.toThrow(/já existe um cadastro/i);
  });

  it('traduz unique_violation em 409 mesmo com o código só em `.cause` (drizzle-orm 0.45)', async () => {
    const { svc } = makeService({
      select: [sessionRow()],
      // Forma real do DrizzleQueryError: o `code` do PostgresError vem em `.cause`,
      // não em `error.code` — é exatamente o formato que passava direto como 500.
      insertError: Object.assign(new Error('Failed query'), {
        cause: Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
        }),
      }),
    });
    await expect(svc.submit('t')).rejects.toThrow(/já existe um cadastro/i);
  });

  it('purgeExpiredSessions retorna a contagem de sessões expurgadas', async () => {
    const { svc } = makeService({ update: [{ id: 'a' }, { id: 'b' }] });
    await expect(svc.purgeExpiredSessions()).resolves.toBe(2);
  });
});

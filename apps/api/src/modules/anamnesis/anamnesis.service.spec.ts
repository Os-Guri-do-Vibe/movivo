/**
 * Unitários do `AnamnesisService` (US-1.3).
 *
 * Complementam `test/anamnesis.int-spec.ts` (que prova o comportamento contra o
 * banco real: RLS por sessão, cifra, migração). Aqui ficam as ramificações de
 * regra que não dependem de I/O — sobretudo as **travas**: token inexistente,
 * expiração, bloco 2 sem consentimento, blocos incompletos e o gate PAR-Q.
 */
import { PARQ_QUESTION_IDS, PARQ_VERSION, ParqState } from '@movivo/shared';
import { describe, expect, it, vi } from 'vitest';

import { type HealthCipherService, type TenantDatabase } from '../../core/database';
import { AnamnesisService } from './anamnesis.service';
import { type ConsentService } from './consent.service';

const HOUR = 3600_000;
const future = () => new Date(Date.now() + 72 * HOUR);
const past = () => new Date(Date.now() - HOUR);

/** Bloco 2 com 9 respostas PAR-Q; `risky` marca uma como "Sim" (dispara bloqueio). */
function block2(risky: boolean) {
  return {
    parq: {
      version: PARQ_VERSION,
      answers: PARQ_QUESTION_IDS.map((questionId, i) => ({
        questionId,
        answer: risky && i === 0,
      })),
    },
  };
}
const BLOCK1 = { name: 'Fulano de Teste', phoneNumber: '+5511999998888' };

/**
 * `tx` falso configurável por terminal: `select→…→limit` devolve `state.select`;
 * `insert→values→returning` devolve `state.insert`; `update→set→where[.returning]`
 * devolve `state.update`; `execute` devolve []. Cobre os 4 estilos de query do serviço.
 */
interface TxState {
  select?: unknown[];
  insert?: unknown[];
  update?: unknown[];
  /** Faz o INSERT rejeitar — usado para simular unique_violation (23505). */
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
    decryptHealth: vi.fn(() => Promise.resolve(JSON.stringify(block2(false)))),
  } as unknown as HealthCipherService;

  const consents = {
    hasValidHealthConsent: vi.fn(() => Promise.resolve(true)),
    linkSessionToUser: vi.fn(() => Promise.resolve()),
  } as unknown as ConsentService;

  const logger = { info: vi.fn() } as never;
  return { svc: new AnamnesisService(logger, db, cipher, consents), cipher, consents };
}

/** Linha de sessão IN_PROGRESS com os blocos preenchidos (ajustável por override). */
function sessionRow(over: Record<string, unknown> = {}) {
  return {
    id: 'sess-1',
    token: 't'.repeat(64),
    status: 'IN_PROGRESS',
    lastBlock: 1,
    primaryGoal: null,
    parqState: null,
    dataBlock1: BLOCK1,
    dataBlock2: Buffer.from('cipher'),
    dataBlock3: { daysPerWeek: 3 },
    expiresAt: future(),
    ...over,
  };
}

describe('AnamnesisService', () => {
  it('start gera token CSPRNG de 64 hex e TTL de 72h', async () => {
    const { svc } = makeService();
    const res = await svc.start({});
    expect(res.token).toMatch(/^[0-9a-f]{64}$/);
    expect(res.lastBlock).toBe(1);
    expect(res.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('getByToken lança 404 quando o token não existe', async () => {
    const { svc } = makeService({ select: [] });
    await expect(svc.getByToken('nope')).rejects.toThrow(/não encontrada/i);
  });

  it('getByToken de sessão ativa retoma no last_block sem expor o bloco 2', async () => {
    const { svc } = makeService({ select: [sessionRow({ lastBlock: 2, parqState: null })] });
    const view = await svc.getByToken('t');
    expect(view.status).toBe('IN_PROGRESS');
    expect(view.lastBlock).toBe(2);
    expect(view.block2Completed).toBe(true); // preenchido, mas o conteúdo não vaza
  });

  it('patchBlock(1) salva bloco não-sensível como jsonb (sem cifra)', async () => {
    const { svc, cipher } = makeService({ select: [sessionRow()] });
    const res = await svc.patchBlock('t', 1, { name: 'Fulano', phoneNumber: '+5511999998888' });
    expect(cipher.encryptHealth).not.toHaveBeenCalled();
    expect(res.lastBlock).toBe(1);
  });

  it('getByToken expira em voo e não devolve o bloco 2', async () => {
    const { svc } = makeService({
      select: [sessionRow({ status: 'IN_PROGRESS', expiresAt: past() })],
    });
    const view = await svc.getByToken('t');
    expect(view.status).toBe('EXPIRED');
    expect(view.block2Completed).toBe(false);
  });

  it('patchBlock(2) SEM consentimento de saúde é bloqueado (BLOQUEADOR 3)', async () => {
    const { svc, consents } = makeService({ select: [sessionRow()] });
    (consents.hasValidHealthConsent as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    await expect(svc.patchBlock('t', 2, block2(false))).rejects.toThrow(/consentimento de saúde/i);
  });

  it('patchBlock(2) COM consentimento cifra o dado de saúde', async () => {
    const { svc, cipher } = makeService({ select: [sessionRow()] });
    const res = await svc.patchBlock('t', 2, block2(false));
    expect(cipher.encryptHealth).toHaveBeenCalledOnce();
    expect(res.lastBlock).toBe(2);
  });

  it('patchBlock lança 410 em sessão expirada', async () => {
    const { svc } = makeService({ select: [sessionRow({ expiresAt: past() })] });
    await expect(
      svc.patchBlock('t', 1, { name: 'x', phoneNumber: '+5511999998888' }),
    ).rejects.toThrow(/expirada/i);
  });

  it('submit exige os 3 blocos preenchidos', async () => {
    const { svc } = makeService({ select: [sessionRow({ dataBlock3: null })] });
    await expect(svc.submit('t')).rejects.toThrow(/complete os três blocos/i);
  });

  it('submit sem risco no PAR-Q libera e não exige revisão profissional', async () => {
    const { svc, consents } = makeService({ select: [sessionRow()], insert: [{ id: 'user-1' }] });
    const res = await svc.submit('t');
    expect(res.status).toBe('SUBMITTED');
    expect(res.parqState).toBe(ParqState.LIBERADO);
    expect(res.requiresProfessionalReview).toBe(false);
    // Consentimentos da fase anônima migram para o titular criado.
    expect(consents.linkSessionToUser).toHaveBeenCalledWith('sess-1', 'user-1');
  });

  it('submit com risco no PAR-Q BLOQUEIA e marca revisão profissional', async () => {
    const { svc, cipher } = makeService({ select: [sessionRow()], insert: [{ id: 'user-2' }] });
    (cipher.decryptHealth as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      JSON.stringify(block2(true)),
    );
    const res = await svc.submit('t');
    expect(res.parqState).toBe(ParqState.BLOQUEADO_AGUARDANDO_CLEARANCE);
    expect(res.requiresProfessionalReview).toBe(true);
  });

  it('submit lança 409 quando a sessão já foi enviada', async () => {
    const { svc } = makeService({ select: [sessionRow({ status: 'SUBMITTED' })] });
    await expect(svc.submit('t')).rejects.toThrow(/já foi enviada/i);
  });

  it('submit traduz unique_violation (telefone/e-mail já cadastrado) em 409', async () => {
    // O INSERT do usuário estoura a unique constraint do telefone (código 23505).
    const { svc } = makeService({
      select: [sessionRow()],
      insertError: Object.assign(new Error('dup'), { code: '23505' }),
    });
    await expect(svc.submit('t')).rejects.toThrow(/já existe um cadastro/i);
  });

  it('purgeExpiredSessions retorna a contagem de sessões expuradas', async () => {
    const { svc } = makeService({ update: [{ id: 'a' }, { id: 'b' }] });
    await expect(svc.purgeExpiredSessions()).resolves.toBe(2);
  });
});

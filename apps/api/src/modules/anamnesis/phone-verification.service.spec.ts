/**
 * Unitários da verificação de posse do WhatsApp (US-6.5 / TASK-6.5.2).
 *
 * Testes **bloqueantes** da US-6.12: rate limit de envio, rate limit de tentativa,
 * expiração, reenvio idempotente e ausência do código em claro no banco.
 */
import { describe, expect, it, vi } from 'vitest';

import { type TenantDatabase } from '../../core/database';
import { type QueueManager } from '../jobs/queue-manager.service';
import {
  hashPhoneCode,
  PhoneVerificationService,
  PHONE_CODE_MAX_ATTEMPTS,
  PHONE_CODE_MAX_SENDS_PER_SESSION,
  PHONE_CODE_RESEND_COOLDOWN_MS,
  PHONE_CODE_TTL_MS,
  type VerifiableSession,
} from './phone-verification.service';

const PHONE = '+5511999998888';
const SESSION_ID = 'sess-1';

function session(over: Partial<VerifiableSession> = {}): VerifiableSession {
  return {
    id: SESSION_ID,
    phoneE164: null,
    phoneVerifiedAt: null,
    phoneCodeHash: null,
    phoneCodeExpiresAt: null,
    phoneCodeAttempts: 0,
    phoneCodeSentAt: null,
    phoneCodeSendCount: 0,
    ...over,
  };
}

/**
 * Captura o que foi escrito na sessão, para provar que o código nunca vai em claro.
 *
 * `updatedRows = 0` simula a linha que NÃO casou o `WHERE` do UPDATE atômico — é como
 * o banco reporta "outro pedido concorrente chegou antes" / "o teto já estourou".
 */
function makeService(numberSends = 0, updatedRows = 1) {
  const writes: Record<string, unknown>[] = [];
  const rows = Array.from({ length: updatedRows }, () => ({ id: SESSION_ID }));
  const tx = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        writes.push(values);
        return { where: () => ({ returning: () => Promise.resolve(rows) }) };
      },
    }),
    select: () => {
      const chain = {
        from: () => chain,
        where: () => Promise.resolve([{ sends: numberSends }]),
      };
      return chain;
    },
  } as never;

  const db = {
    runAsTokenScoped: vi.fn((_id: string, cb: (t: unknown) => Promise<unknown>) => cb(tx)),
    runAsSystem: vi.fn((cb: (t: unknown) => Promise<unknown>) => cb(tx)),
  } as unknown as TenantDatabase;

  const queues = { enqueue: vi.fn(() => Promise.resolve('job')) } as unknown as QueueManager;
  const logger = { info: vi.fn(), warn: vi.fn(), setContext: vi.fn() } as never;
  return { svc: new PhoneVerificationService(db, queues, logger), writes, queues };
}

describe('envio do código', () => {
  it('gera 6 dígitos, enfileira no WhatsApp e persiste SOMENTE o hash', async () => {
    const { svc, writes, queues } = makeService();
    const result = await svc.sendCode(session(), PHONE);

    expect(result.sent).toBe(true);
    const job = (queues.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]?.[2] as {
      code: string;
      phoneNumber: string;
      type: string;
    };
    expect(job.type).toBe('PHONE_VERIFICATION');
    expect(job.phoneNumber).toBe(PHONE);
    expect(job.code).toMatch(/^\d{6}$/);

    const written = writes[0] as { phoneCodeHash: string };
    expect(written.phoneCodeHash).toBe(hashPhoneCode(SESSION_ID, job.code));
    // O código em claro nunca aparece no que vai para o banco.
    expect(JSON.stringify(writes)).not.toContain(job.code);
  });

  it('expira em 10 minutos e libera o reenvio em 60s', async () => {
    const { svc } = makeService();
    const now = new Date('2026-08-10T12:00:00Z');
    const result = await svc.sendCode(session(), PHONE, now);
    expect(result.expiresAt.getTime() - now.getTime()).toBe(PHONE_CODE_TTL_MS);
    expect(result.resendAvailableAt.getTime() - now.getTime()).toBe(PHONE_CODE_RESEND_COOLDOWN_MS);
  });

  it('reenvio dentro do cooldown é idempotente: não envia de novo nem invalida o código', async () => {
    const { svc, queues, writes } = makeService();
    const now = new Date('2026-08-10T12:00:30Z');
    const result = await svc.sendCode(
      session({
        phoneE164: PHONE,
        phoneCodeSentAt: new Date('2026-08-10T12:00:00Z'),
        phoneCodeExpiresAt: new Date('2026-08-10T12:10:00Z'),
        phoneCodeHash: 'abc',
        phoneCodeSendCount: 1,
      }),
      PHONE,
      now,
    );
    expect(result.sent).toBe(false);
    expect(queues.enqueue).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it('bloqueia o abuso de envio por sessão', async () => {
    const { svc } = makeService();
    await expect(
      svc.sendCode(
        session({ phoneE164: PHONE, phoneCodeSendCount: PHONE_CODE_MAX_SENDS_PER_SESSION }),
        PHONE,
      ),
    ).rejects.toThrow(/muitas tentativas/i);
  });

  it('bloqueia o abuso de envio por NÚMERO, mesmo em sessões novas', async () => {
    const { svc } = makeService(10);
    await expect(svc.sendCode(session(), PHONE)).rejects.toThrow(/muitas tentativas/i);
  });

  it('não envia quando perde a corrida do CAS (dois pedidos simultâneos)', async () => {
    const { svc, queues } = makeService(0, 0);
    const result = await svc.sendCode(session(), PHONE);
    expect(result.sent).toBe(false);
    expect(queues.enqueue).not.toHaveBeenCalled();
  });

  it('não deixa o código do OTP residir no Redis depois do job', async () => {
    const { svc, queues } = makeService();
    await svc.sendCode(session(), PHONE);
    const opts = (queues.enqueue as ReturnType<typeof vi.fn>).mock.calls[0]?.[3] as {
      removeOnComplete: boolean;
      removeOnFail: boolean;
    };
    expect(opts.removeOnComplete).toBe(true);
    expect(opts.removeOnFail).toBe(true);
  });

  it('trocar de número derruba a verificação anterior', async () => {
    const { svc, writes } = makeService();
    await svc.sendCode(
      session({ phoneE164: '+5511900000000', phoneVerifiedAt: new Date(), phoneCodeSendCount: 3 }),
      PHONE,
    );
    const written = writes[0] as { phoneVerifiedAt: Date | null; phoneCodeSendCount: number };
    expect(written.phoneVerifiedAt).toBeNull();
    // O contador de envios recomeça no número novo (é outro número, outro teto de sessão).
    expect(written.phoneCodeSendCount).toBe(1);
  });
});

describe('verificação do código', () => {
  const valid = (code: string, over: Partial<VerifiableSession> = {}) =>
    session({
      phoneCodeHash: hashPhoneCode(SESSION_ID, code),
      phoneCodeExpiresAt: new Date(Date.now() + PHONE_CODE_TTL_MS),
      ...over,
    });

  it('marca como verificado e limpa o código no acerto', async () => {
    const { svc, writes } = makeService();
    await svc.verify(valid('123456'), '123456');
    // writes[0] é o débito atômico da tentativa; writes[1] é a marcação do sucesso.
    const written = writes[1] as { phoneVerifiedAt: Date; phoneCodeHash: null };
    expect(written.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(written.phoneCodeHash).toBeNull();
  });

  it('recusa código errado e debita a tentativa ANTES de conferir', async () => {
    const { svc, writes } = makeService();
    await expect(svc.verify(valid('123456'), '000000')).rejects.toThrow(/não confere/i);
    // O débito é expressão SQL (`attempts + 1`), não um número lido na aplicação:
    // é o que impede N pedidos simultâneos de gastarem a mesma tentativa.
    const written = writes[0] as Record<string, unknown>;
    expect(typeof written.phoneCodeAttempts).toBe('object');
    // A invalidação ao estourar o teto vai no mesmo UPDATE (CASE WHEN), sem round-trip.
    expect(typeof written.phoneCodeHash).toBe('object');
    expect(typeof written.phoneCodeExpiresAt).toBe('object');
  });

  it('recusa quando o débito não casa linha nenhuma (teto estourado em corrida)', async () => {
    const { svc } = makeService(0, 0);
    await expect(svc.verify(valid('123456'), '123456')).rejects.toThrow(/muitas tentativas/i);
  });

  it('bloqueia a força bruta depois do teto de tentativas', async () => {
    const { svc } = makeService();
    await expect(
      svc.verify(valid('123456', { phoneCodeAttempts: PHONE_CODE_MAX_ATTEMPTS }), '123456'),
    ).rejects.toThrow(/muitas tentativas/i);
  });

  it('recusa código expirado com mensagem própria (o usuário precisa pedir outro)', async () => {
    const { svc } = makeService();
    await expect(
      svc.verify(valid('123456', { phoneCodeExpiresAt: new Date(Date.now() - 1000) }), '123456'),
    ).rejects.toThrow(/expirou/i);
  });

  it('não vira oráculo: sessão sem código pendente responde igual a código errado', async () => {
    const { svc } = makeService();
    await expect(svc.verify(session(), '123456')).rejects.toThrow(/não confere/i);
  });
});

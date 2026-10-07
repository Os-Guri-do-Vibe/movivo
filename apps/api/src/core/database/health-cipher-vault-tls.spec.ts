import { EventEmitter } from 'node:events';
import { request as httpsRequest } from 'node:https';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HealthCipherService } from './health-cipher.service';

vi.mock('node:https', () => ({ request: vi.fn() }));

function service() {
  return new HealthCipherService(
    { execute: vi.fn() } as never,
    {
      pgcryptoKey: 'legacy-test-only',
      healthCipher: {
        provider: 'VAULT',
        vaultCa: 'private-ca',
        vaultAddr: 'https://vault.local',
        vaultToken: 'application-token',
        vaultKey: 'health',
        vaultTimeoutMs: 1000,
      },
    } as never,
  );
}

function mockReply(statusCode: number, body: string, error?: Error) {
  vi.mocked(httpsRequest).mockImplementation((...args: unknown[]) => {
    const callback = args[2] as (response: unknown) => void;
    const response = Object.assign(new EventEmitter(), {
      statusCode,
      resume: vi.fn(),
      destroy: (cause: Error) => response.emit('error', cause),
    });
    const request = Object.assign(new EventEmitter(), {
      end: vi.fn(() =>
        queueMicrotask(() => {
          if (error) {
            request.emit('error', error);
            return;
          }
          callback(response);
          if (statusCode === 200) {
            response.emit('data', Buffer.from(body));
            response.emit('end');
          }
        }),
      ),
    });
    return request as never;
  });
}

beforeEach(() => vi.clearAllMocks());
describe('Vault HTTPS com CA privada', () => {
  it('aplica CA só ao endpoint Vault, valida certificados e mantém timeout', async () => {
    mockReply(200, JSON.stringify({ data: { ciphertext: 'vault:v2:encrypted' } }));
    expect((await service().encryptHealth('texto')).toString()).toBe('vault:v2:encrypted');
    expect(vi.mocked(httpsRequest).mock.calls[0]?.[0]).toBe(
      'https://vault.local/v1/transit/encrypt/health',
    );
    expect(vi.mocked(httpsRequest).mock.calls[0]?.[1]).toMatchObject({
      ca: 'private-ca',
      rejectUnauthorized: true,
      signal: expect.any(AbortSignal),
      headers: { 'X-Vault-Token': 'application-token' },
    });
  });
  it('TLS rejeitado gera erro sanitizado sem fallback ou causa sensível', async () => {
    mockReply(200, '', new Error('bad certificate application-token details'));
    await expect(service().encryptHealth('texto')).rejects.toThrow(
      /^HealthCipherService: falha ao cifrar\.$/,
    );
    expect(httpsRequest).toHaveBeenCalledTimes(1);
  });
  it('não segue redirecionamento e recusa falha HTTP', async () => {
    for (const status of [301, 304, 403, 503]) {
      mockReply(status, 'sensitive response');
      await expect(service().encryptHealth('texto')).rejects.toThrow('falha ao cifrar');
    }
    expect(httpsRequest).toHaveBeenCalledTimes(4);
  });
  it('recusa resposta excedendo limite de memória', async () => {
    mockReply(200, 'a'.repeat(2 * 1024 * 1024 + 1));
    await expect(service().encryptHealth('texto')).rejects.toThrow('falha ao cifrar');
  });
});

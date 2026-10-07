import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { HealthCipherService } from './health-cipher.service';

const KEY = 'segredo-aleatorio-legado-de-teste';
const keyring = {
  old: randomBytes(32).toString('base64'),
  current: randomBytes(32).toString('base64'),
};
function service(keyId = 'current', keys = keyring) {
  const execute = vi.fn();
  const config = { pgcryptoKey: KEY, healthCipher: { provider: 'LOCAL', keyId, keyring: keys } };
  return { svc: new HealthCipherService({ execute } as never, config as never), execute, config };
}

afterEach(() => vi.unstubAllGlobals());
describe('HealthCipherService', () => {
  it('cifra na aplicação sem enviar segredo ou plaintext ao banco, com IV aleatório', async () => {
    const { svc, execute } = service();
    const text = '{"parq":true,"dor":"joelho"}';
    const a = await svc.encryptHealth(text);
    const b = await svc.encryptHealth(text);
    expect(a.equals(b)).toBe(false);
    expect(a.toString()).not.toContain(text);
    expect(await svc.decryptHealth(a)).toBe(text);
    expect(await svc.decryptHealth(b)).toBe(text);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rotação lê old/new, rollback retém ambas, e remover chave antiga falha fechado', async () => {
    const old = await service('old').svc.encryptHealth('histórico');
    const current = await service().svc.encryptHealth('novo');
    expect(await service().svc.decryptHealth(old)).toBe('histórico');
    expect(await service('old').svc.decryptHealth(current)).toBe('novo');
    await expect(
      service('current', { current: keyring.current } as typeof keyring).svc.decryptHealth(old),
    ).rejects.toThrow('falha ao decifrar');
  });

  it('recifra legado de aplicação com a chave ativa, sem alterar plaintext', async () => {
    const { svc } = service();
    const legacy = new HealthCipherService(
      { execute: vi.fn() } as never,
      { pgcryptoKey: KEY } as never,
    );
    const before = await legacy.encryptHealth('histórico');
    const after = await svc.encryptHealth(await svc.decryptHealth(before));
    expect(after.toString()).toContain('v1:current:');
    expect(await svc.decryptHealth(after)).toBe('histórico');
  });

  it('autentica ciphertext, ID, IV e tag; rejeita truncamento sem consultas SQL', async () => {
    const { svc, execute } = service();
    const valid = await svc.encryptHealth('segredo');
    for (const index of [0, 19, valid.length - 30, valid.length - 20, valid.length - 1]) {
      const damaged = Buffer.from(valid);
      damaged[index] = (damaged[index] ?? 0) ^ 1;
      await expect(svc.decryptHealth(damaged)).rejects.toThrow('falha ao decifrar');
    }
    await expect(svc.decryptHealth(valid.subarray(0, 22))).rejects.toThrow('falha ao decifrar');
    expect(execute).not.toHaveBeenCalled();
  });

  it('preserva pgcrypto legado e sanitiza erro do driver sem causa/query/params', async () => {
    const { svc, execute } = service();
    execute.mockResolvedValueOnce([{ plaintext: 'legado' }]);
    expect(await svc.decryptHealth(Buffer.from([0xc3, 1]))).toBe('legado');
    execute.mockRejectedValueOnce(new Error(`query params: ${KEY} dor no joelho`));
    try {
      await svc.decryptHealth(Buffer.from([0xc3, 1]));
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(KEY);
      expect((error as Error).message).not.toContain('joelho');
      expect((error as Error).cause).toBeUndefined();
    }
  });

  it('Vault Transit cifra/decifra sem banco, com timeout e sem redirecionamento', async () => {
    const { svc, config, execute } = service();
    Object.assign(config.healthCipher, {
      provider: 'VAULT',
      vaultAddr: 'https://vault.example/',
      vaultToken: 'token-test',
      vaultKey: 'health',
      vaultTimeoutMs: 1000,
    });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { ciphertext: 'vault:v2:cipher' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { plaintext: Buffer.from('saúde').toString('base64') } }),
      });
    vi.stubGlobal('fetch', fetcher);
    const encrypted = await svc.encryptHealth('saúde');
    expect(await svc.decryptHealth(encrypted)).toBe('saúde');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://vault.example/v1/transit/encrypt/health');
    expect(execute).not.toHaveBeenCalled();
  });

  it('Vault indisponível não faz fallback nem expõe resposta ou token', async () => {
    const { svc, config, execute } = service();
    Object.assign(config.healthCipher, {
      provider: 'VAULT',
      vaultAddr: 'https://vault.example',
      vaultToken: 'token-test',
      vaultKey: 'health',
      vaultTimeoutMs: 1000,
    });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('token-test detalhe-sensível')));
    await expect(svc.encryptHealth('saúde')).rejects.toThrow(
      /^HealthCipherService: falha ao cifrar\.$/,
    );
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('Vault malformed response', () => {
  it('recusa plaintext que não é base64 válido', async () => {
    const { svc, config } = service();
    Object.assign(config.healthCipher, {
      vaultAddr: 'https://vault.example',
      vaultToken: 'token',
      vaultKey: 'health',
      vaultTimeoutMs: 1000,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { plaintext: 'not base64!' } }),
      }),
    );
    await expect(svc.decryptHealth(Buffer.from('vault:v1:cipher'))).rejects.toThrow(
      'falha ao decifrar',
    );
  });
});

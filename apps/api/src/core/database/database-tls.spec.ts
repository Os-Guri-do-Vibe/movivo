import { describe, it, expect, vi } from 'vitest';
import type { PeerCertificate } from 'node:tls';
import { AppConfigService } from '../config';
import { createPostgresClient } from './database.module';
import postgres from 'postgres';

vi.mock('postgres', () => ({ default: vi.fn() }));

describe('TLS PostgreSQL runtime', () => {
  it('recusa certificado válido para outro host, sem permitir downgrade de SSL', () => {
    const config = {
      database: { host: 'pgbouncer', ssl: true, sslCa: 'private-ca' },
    } as AppConfigService;
    createPostgresClient(config);
    const options = vi.mocked(postgres).mock.calls[0]?.[0] as unknown as {
      ssl: {
        ca: string;
        rejectUnauthorized: boolean;
        checkServerIdentity: (hostname: string, cert: PeerCertificate) => Error | undefined;
      };
    };
    expect(options.ssl.ca).toBe('private-ca');
    expect(options.ssl.rejectUnauthorized).toBe(true);
    expect(
      options.ssl.checkServerIdentity('localhost', {
        subjectaltname: 'DNS:other-host',
      } as PeerCertificate),
    ).toBeInstanceOf(Error);
    expect(
      options.ssl.checkServerIdentity('localhost', {
        subjectaltname: 'DNS:pgbouncer',
      } as PeerCertificate),
    ).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import type { PeerCertificate } from 'node:tls';
import { migrationPostgresTls, postgresTls } from './postgres-tls';

describe('TLS PostgreSQL compartilhado por runtime e manutenção', () => {
  it('mantém plaintext só quando explicitamente permitido, sem ignorar CA', () => {
    expect(migrationPostgresTls({}, 'localhost')).toBe(false);
    expect(() => migrationPostgresTls({ MIGRATION_DATABASE_SSL_CA: 'ca' }, 'host')).toThrow('TLS');
    expect(() => migrationPostgresTls({ MIGRATION_DATABASE_SSL: 'invalid' }, 'host')).toThrow(
      'booleano',
    );
  });
  it('migração reutiliza CA/flag do runtime ou configuração direta explícita', () => {
    expect(
      migrationPostgresTls({ DATABASE_SSL: 'true', DATABASE_SSL_CA: 'runtime-ca' }, 'postgres'),
    ).toMatchObject({ ca: 'runtime-ca', rejectUnauthorized: true });
    expect(
      migrationPostgresTls(
        {
          DATABASE_SSL: 'true',
          DATABASE_SSL_CA: 'runtime-ca',
          MIGRATION_DATABASE_SSL: 'yes',
          MIGRATION_DATABASE_SSL_CA: 'migration-ca',
        },
        'postgres',
      ),
    ).toMatchObject({ ca: 'migration-ca', rejectUnauthorized: true });
  });
  it('verifica host/IP de destino e rejeita certificado confiável para outro serviço', () => {
    const options = postgresTls('127.0.0.1', true, 'ca');
    if (options === false || !options.checkServerIdentity) throw new Error('TLS não configurado');
    expect(
      options.checkServerIdentity('localhost', {
        subjectaltname: 'DNS:localhost',
      } as PeerCertificate),
    ).toBeInstanceOf(Error);
    expect(
      options.checkServerIdentity('localhost', {
        subjectaltname: 'IP Address:127.0.0.1',
      } as PeerCertificate),
    ).toBeUndefined();
  });
});

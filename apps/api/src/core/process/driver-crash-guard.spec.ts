import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

import { installPostgresDriverCrashGuard, isPostgresDriverWriteCrash } from './driver-crash-guard';

function driverError(): TypeError {
  const error = new TypeError("Cannot read properties of null (reading 'write')");
  error.stack = `${error.name}: ${error.message}
    at Immediate.nextWrite (/app/node_modules/.pnpm/postgres@3.4.9/node_modules/postgres/cjs/src/connection.js:255:22)
    at process.processImmediate (node:internal/timers:485:21)`;
  return error;
}

function fakeProcess() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, { exit: vi.fn() }) as unknown as NodeJS.Process & {
    exit: ReturnType<typeof vi.fn>;
  };
}

const logger = () => ({ error: vi.fn(), fatal: vi.fn() });

describe('isPostgresDriverWriteCrash', () => {
  it('reconhece o TypeError do driver pela mensagem e pela pilha', () => {
    expect(isPostgresDriverWriteCrash(driverError())).toBe(true);
  });

  it('não confunde com o mesmo TypeError vindo de código da aplicação', () => {
    const error = new TypeError("Cannot read properties of null (reading 'write')");
    error.stack = `${error.name}: ${error.message}\n    at Foo.bar (/app/apps/api/src/foo.ts:10:5)`;
    expect(isPostgresDriverWriteCrash(error)).toBe(false);
  });

  it('não reconhece outros erros nem valores que não são Error', () => {
    expect(isPostgresDriverWriteCrash(new Error('boom'))).toBe(false);
    expect(isPostgresDriverWriteCrash('texto')).toBe(false);
    expect(isPostgresDriverWriteCrash(undefined)).toBe(false);
  });
});

describe('installPostgresDriverCrashGuard', () => {
  it('absorve o erro do driver sem encerrar o processo', () => {
    const proc = fakeProcess();
    const log = logger();
    installPostgresDriverCrashGuard(log, proc);
    proc.emit('uncaughtException', driverError());
    expect(proc.exit).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.fatal).not.toHaveBeenCalled();
  });

  it('qualquer outra exceção não capturada continua derrubando o processo', () => {
    const proc = fakeProcess();
    const log = logger();
    installPostgresDriverCrashGuard(log, proc);
    proc.emit('uncaughtException', new Error('falha real'));
    expect(log.fatal).toHaveBeenCalledTimes(1);
    expect(proc.exit).toHaveBeenCalledWith(1);
  });

  it('é idempotente: instalar duas vezes não duplica o handler', () => {
    const proc = fakeProcess();
    expect(installPostgresDriverCrashGuard(logger(), proc)).toBe(true);
    expect(installPostgresDriverCrashGuard(logger(), proc)).toBe(false);
    expect(proc.listenerCount('uncaughtException')).toBe(1);
  });
});

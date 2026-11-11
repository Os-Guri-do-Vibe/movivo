/**
 * Guarda contra a queda do processo por um bug conhecido do driver `postgres` (porsager).
 *
 * Quando o servidor encerra uma conexão (idle-in-transaction timeout, PgBouncer reciclando,
 * rede) enquanto o driver ainda tem um chunk na fila de escrita, o `setImmediate` do driver
 * chama `socket.write` num socket já `null` e lança
 * `TypeError: Cannot read properties of null (reading 'write')` FORA de qualquer promise —
 * ninguém consegue capturar, o Node cai (exit 1) e leva junto toda requisição em andamento
 * (e, atrás do Docker, o sidecar TLS que divide a rede da API fica sem rede). A consulta
 * afetada já falha por conta própria com `CONNECTION_CLOSED`, então perder esse erro não
 * esconde nada.
 *
 * Só ESSE erro é absorvido: identificado pela mensagem e pela pilha dentro do driver.
 * Qualquer outra exceção não capturada segue derrubando o processo, como antes.
 */
const DRIVER_FRAME = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?postgres\/.*connection\.js/;

export function isPostgresDriverWriteCrash(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    /Cannot read properties of null \(reading 'write'\)/.test(error.message) &&
    DRIVER_FRAME.test(error.stack ?? '')
  );
}

interface GuardLogger {
  error(payload: Record<string, unknown>, message: string): void;
  fatal(payload: Record<string, unknown>, message: string): void;
}

/** Instala o handler uma única vez. Devolve `false` se já estava instalado. */
export function installPostgresDriverCrashGuard(
  logger: GuardLogger,
  proc: Pick<NodeJS.Process, 'on' | 'exit' | 'listenerCount'> = process,
): boolean {
  const MARK = 'movivo-postgres-crash-guard';
  if ((proc as unknown as Record<string, unknown>)[MARK]) return false;
  (proc as unknown as Record<string, unknown>)[MARK] = true;

  proc.on('uncaughtException', (error: unknown) => {
    if (isPostgresDriverWriteCrash(error)) {
      logger.error(
        { event: 'postgres_driver_write_after_close' },
        'conexão com o banco encerrada no meio de uma escrita; processo mantido',
      );
      return;
    }
    // Registrar um handler desliga o comportamento padrão: reproduzimos o padrão aqui.
    logger.fatal(
      { event: 'uncaught_exception', err: String((error as Error | undefined)?.stack ?? error) },
      'exceção não capturada; encerrando',
    );
    proc.exit(1);
  });
  return true;
}

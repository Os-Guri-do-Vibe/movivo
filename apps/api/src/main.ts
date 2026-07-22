/**
 * `apps/api` — STUB da US-0.1 (TASK-0.1.1).
 *
 * Este arquivo existe **apenas** para provar que o tooling da raiz (pnpm workspaces,
 * Turborepo, TypeScript strict, ESLint, Prettier) funciona de ponta a ponta e que
 * `@movivo/shared` é consumível pelo backend.
 *
 * O bootstrap real do NestJS (prefixo `api/v1`, ValidationPipe global, graceful
 * shutdown, CORS por env, porta 3001) é escopo da **US-0.3** — não implementar aqui.
 */
import { API_VERSION_PREFIX, APP_VERSION, ProtocolStatus } from '@movivo/shared';

/** Porta do backend conforme o C4 nível 2 (`ARQUITETURA.md` §4). */
export const API_PORT = 3001;

export interface ApiStubInfo {
  readonly service: 'movivo-api';
  readonly version: string;
  readonly versionPrefix: string;
  readonly port: number;
  /** Prova de que os enums de domínio compartilhados chegam ao backend. */
  readonly initialProtocolStatus: typeof ProtocolStatus.DRAFT;
}

export function getApiStubInfo(): ApiStubInfo {
  return {
    service: 'movivo-api',
    version: APP_VERSION,
    versionPrefix: API_VERSION_PREFIX,
    port: API_PORT,
    initialProtocolStatus: ProtocolStatus.DRAFT,
  };
}

if (require.main === module) {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(getApiStubInfo()));
}

/**
 * `apps/web` — STUB da US-0.1 (TASK-0.1.1).
 *
 * Existe apenas para provar que `@movivo/shared` resolve no workspace do frontend
 * e que o tooling da raiz cobre `apps/web`.
 *
 * O scaffold real (Next.js 15 App Router, React 19, Tailwind + shadcn/ui com os
 * tokens do design system "O Pulso", PostHog) é escopo da **US-0.5** (Felipe).
 */
import { APP_VERSION, SubscriptionStatus } from '@movivo/shared';

/** Porta do frontend conforme o C4 nível 2 (`ARQUITETURA.md` §4). */
export const WEB_PORT = 3000;

export interface WebStubInfo {
  readonly app: 'movivo-web';
  readonly version: string;
  readonly port: number;
  /** Prova de que os enums de domínio compartilhados chegam ao frontend. */
  readonly defaultSubscriptionStatus: typeof SubscriptionStatus.TRIALING;
}

export function getWebStubInfo(): WebStubInfo {
  return {
    app: 'movivo-web',
    version: APP_VERSION,
    port: WEB_PORT,
    defaultSubscriptionStatus: SubscriptionStatus.TRIALING,
  };
}

/**
 * Configuração pública do frontend (US-0.5 / TASK-0.5.3).
 *
 * ⚠️ Tudo neste arquivo é **público**. O Next.js substitui `process.env.NEXT_PUBLIC_*`
 * pelo literal no momento do build e o valor viaja dentro do bundle JavaScript servido
 * ao browser. Nenhum segredo de servidor pode ser lido aqui — nem indiretamente.
 * Segredos de servidor (a partir da Sprint 2: `AUTH_SECRET`) seguem o contrato `*_FILE`
 * descrito em `SECURITY.md` §2 e são lidos exclusivamente em código de servidor.
 *
 * A leitura é feita como acesso literal a `process.env.NEXT_PUBLIC_X` de propósito:
 * acesso dinâmico (`process.env[nome]`) não é substituído pelo compilador e chegaria
 * `undefined` no browser.
 */

/** Valor de placeholder que `apps/web/.env.example` traz — não é uma credencial. */
const POSTHOG_PLACEHOLDER = 'phc_placeholder_project_api_key';

function optional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
}

/**
 * A *project API key* do PostHog (prefixo `phc_`) é pública por desenho — é a
 * credencial de ingestão do cliente. A *Personal API Key* (`phx_`) é secreta e nunca
 * pode aparecer aqui; se alguém colar uma por engano, ela é descartada em vez de ir
 * para o bundle.
 */
function resolvePostHogKey(): string | undefined {
  const key = optional(process.env.NEXT_PUBLIC_POSTHOG_KEY);
  if (key === undefined || key === POSTHOG_PLACEHOLDER) return undefined;
  return key.startsWith('phc_') ? key : undefined;
}

export const publicEnv = {
  /** `local` | `staging` | `production` — só rotula ambiente, não libera comportamento. */
  appEnv: optional(process.env.NEXT_PUBLIC_APP_ENV) ?? 'local',
  siteUrl: optional(process.env.NEXT_PUBLIC_SITE_URL) ?? 'http://localhost:3000',
  /** Base da API NestJS (US-0.3), sempre versionada em `api/v1` (regra §12.10). */
  apiUrl: optional(process.env.NEXT_PUBLIC_API_URL) ?? 'http://localhost:3001/api/v1',
  posthog: {
    key: resolvePostHogKey(),
    host: optional(process.env.NEXT_PUBLIC_POSTHOG_HOST) ?? 'https://us.i.posthog.com',
  },
} as const;

/** `true` quando há uma project key válida — a analytics é opcional, nunca bloqueante. */
export const isAnalyticsEnabled = publicEnv.posthog.key !== undefined;

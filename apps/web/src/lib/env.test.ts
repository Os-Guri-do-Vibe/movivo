/**
 * Testes do resolvedor de configuração pública do frontend (US-0.8, Mariana).
 *
 * `env.ts` lê `process.env.NEXT_PUBLIC_*` no momento em que o módulo é avaliado, então
 * cada caso reescreve o env com `vi.stubEnv`, invalida o cache de módulos e reimporta.
 *
 * O caso mais importante é de SEGURANÇA: a *project key* do PostHog (`phc_`) é pública,
 * mas uma *Personal API Key* (`phx_`) é secreta e JAMAIS pode ir para o bundle do
 * cliente. `resolvePostHogKey` descarta qualquer chave que não comece com `phc_`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

async function importEnv() {
  vi.resetModules();
  return import('@/lib/env');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('publicEnv', () => {
  it('aplica os defaults quando nenhuma variável está definida', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_ENV', '');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_API_URL', '');
    const { publicEnv, isAnalyticsEnabled } = await importEnv();
    expect(publicEnv.appEnv).toBe('local');
    expect(publicEnv.siteUrl).toBe('http://localhost:3000');
    expect(publicEnv.apiUrl).toBe('http://localhost:3001/api/v1');
    expect(isAnalyticsEnabled).toBe(false);
  });

  it('aceita uma project key pública válida (prefixo phc_)', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_chave_publica_valida');
    const { publicEnv, isAnalyticsEnabled } = await importEnv();
    expect(publicEnv.posthog.key).toBe('phc_chave_publica_valida');
    expect(isAnalyticsEnabled).toBe(true);
  });

  it('DESCARTA uma Personal API Key secreta (phx_) — nunca vai para o bundle', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phx_chave_secreta_pessoal');
    const { publicEnv, isAnalyticsEnabled } = await importEnv();
    expect(publicEnv.posthog.key).toBeUndefined();
    expect(isAnalyticsEnabled).toBe(false);
  });

  it('trata o placeholder do .env.example como ausência de key', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_placeholder_project_api_key');
    const { isAnalyticsEnabled } = await importEnv();
    expect(isAnalyticsEnabled).toBe(false);
  });

  it('usa o host de PostHog informado quando presente', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://eu.i.posthog.com');
    const { publicEnv } = await importEnv();
    expect(publicEnv.posthog.host).toBe('https://eu.i.posthog.com');
  });
});

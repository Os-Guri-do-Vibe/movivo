import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * Configuração do Next.js 16 (App Router) — `apps/web` (US-0.5 / TASK-0.5.1).
 *
 * Sobre o bundler: o Next 16 tornou o **Turbopack o padrão** para `next dev` e
 * `next build`. Este app opta explicitamente por **webpack** em ambos (`--webpack`,
 * ver `package.json`). Motivo: o Turbopack resolve os *named exports* do pacote de
 * workspace `@movivo/shared` (CJS gerado pelo `tsc`) como `undefined` —
 * silenciosamente, sem erro: a página sobe e os valores vindos do pacote (`APP_VERSION`,
 * `API_VERSION_PREFIX`) aparecem vazios. O smoke E2E da US-0.8 (Mariana) pega isso.
 *
 * Reconfirmado empiricamente no Next 16.2.11 (jul/2026): com `next dev --turbopack`,
 * a home renderiza `Versão (@movivo/shared)` e `Prefixo da API` VAZIOS e `0.1.0` não
 * aparece; `transpilePackages: ['@movivo/shared']` NÃO corrige (idêntico ao Next 15).
 * Com webpack (dev e `next build`) a interop resolve e `0.1.0` aparece. Enquanto o
 * bug de interop CJS↔ESM do Turbopack existir, dev/build = webpack. Revisitar quando
 * o Turbopack estabilizar a interop de workspace (ou migrar `@movivo/shared` para um
 * build ESM real — fora do escopo desta atualização, pois o pacote é consumido também
 * pela API NestJS em CJS).
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  /*
   * Num monorepo, o Next infere a raiz do projeto pelo lockfile mais próximo e emite
   * aviso quando encontra mais de um candidato. Fixar a raiz torna o file tracing do
   * build determinístico entre a máquina do dev e o CI (US-0.7).
   */
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),

  /* Não anunciar o framework/versão para quem faz reconhecimento de superfície. */
  poweredByHeader: false,

  /*
   * No Next 15, o `next build` rodava um ESLint próprio (silenciado aqui com
   * `eslint: { ignoreDuringBuilds: true }`). O Next 16 removeu o `next lint` e a chave
   * `eslint` da config — o passo interno não existe mais, então o bloco foi removido.
   * O gate real de lint continua sendo `pnpm run lint` (raiz), com um flat config único
   * que registra `@next/eslint-plugin-next` (presets `recommended` + `core-web-vitals`),
   * obrigatório no CI da US-0.7.
   */

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          /*
           * Baseline de cabeçalhos de segurança. A CSP com nonce por request é
           * escopo do threat model de Sato aplicado às telas reais (Sprint 1+):
           * uma CSP estrita escrita agora, sem superfície para proteger, nasceria
           * frouxa (`unsafe-inline`/`unsafe-eval`) e viraria falso conforto.
           */
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;

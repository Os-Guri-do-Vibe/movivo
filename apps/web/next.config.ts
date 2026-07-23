import path from 'node:path';
import type { NextConfig } from 'next';

/**
 * Configuração do Next.js 15 (App Router) — `apps/web` (US-0.5 / TASK-0.5.1).
 *
 * Sobre bundler de desenvolvimento: o `dev` deste app roda em **webpack**, não em
 * Turbopack (ver `package.json`). O Turbopack em dev resolve os *named exports* do
 * pacote de workspace `@movivo/shared` (CJS gerado pelo tsc) como `undefined` —
 * silenciosamente, sem erro: a página sobe e os valores vindos do pacote aparecem
 * vazios. O smoke E2E da US-0.8 (Mariana) pegou isso. Testado: webpack (dev e
 * `next build`) resolve corretamente; nem `transpilePackages` nem um build ESM
 * dual do pacote fizeram o Turbopack resolver. Enquanto o bug do Turbopack existir,
 * dev = webpack. Revisitar quando o Turbopack estabilizar a interop de workspace.
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
   * O `next build` roda um ESLint próprio, resolvido a partir de `apps/web` e à
   * procura de `eslint-config-next`. Este monorepo lint a partir da RAIZ, com um flat
   * config único que já registra `@next/eslint-plugin-next` com os presets
   * `recommended` + `core-web-vitals` (`eslint.config.mjs`, bloco `movivo/apps-web`).
   * Manter o passo interno ligado significaria duas execuções de ESLint com
   * configurações diferentes — e a de dentro, mal configurada, avisando que "o plugin
   * não foi detectado". O gate real de lint é `pnpm run lint` (raiz), obrigatório no
   * CI da US-0.7. Instalar `eslint-config-next` só para calar o aviso duplicaria o
   * preset React/Next já montado à mão.
   */
  eslint: { ignoreDuringBuilds: true },

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

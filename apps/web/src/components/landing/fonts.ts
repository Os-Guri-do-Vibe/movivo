import localFont from 'next/font/local';
import { Quicksand } from 'next/font/google';

/*
 * Tipografia da landing pública. Declarada aqui (e não no layout raiz) para que só a
 * landing baixe estas famílias — painel, onboarding e protocolo seguem com a
 * tipografia do app. Tudo auto-hospedado pelo `next/font`: zero requisição a terceiros
 * em runtime e métricas de fallback ajustadas (CLS controlado).
 *
 * Cabinet Grotesk e Satoshi: WOFF2 oficiais da Indian Type Foundry (Fontshare, licença
 * ITF Free Font License) — ver `ASSET_MANIFEST.md`.
 */
export const cabinetGrotesk = localFont({
  src: [
    { path: './fonts/CabinetGrotesk-700.woff2', weight: '700', style: 'normal' },
    { path: './fonts/CabinetGrotesk-800.woff2', weight: '800', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-cabinet',
  fallback: ['Helvetica Neue', 'Arial', 'sans-serif'],
});

export const satoshi = localFont({
  src: [
    { path: './fonts/Satoshi-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/Satoshi-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/Satoshi-700.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-satoshi',
  fallback: ['Helvetica Neue', 'Arial', 'system-ui', 'sans-serif'],
});

/** Assinaturas proprietárias (a mesma família do lettering do logo). */
export const quicksand = Quicksand({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-quicksand',
  preload: false,
});

export const landingFontVariables = [
  cabinetGrotesk.variable,
  satoshi.variable,
  quicksand.variable,
].join(' ');

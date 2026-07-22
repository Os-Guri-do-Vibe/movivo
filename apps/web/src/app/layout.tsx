import type { Metadata, Viewport } from 'next';
import { Hanken_Grotesk, JetBrains_Mono } from 'next/font/google';

import { ThemeProvider } from '@/components/theme-provider';
import { publicEnv } from '@/lib/env';

import './globals.css';

/*
 * Tipografia de Kimura §4. `next/font` baixa e **auto-hospeda** os arquivos no build:
 * zero requisição a fonts.googleapis.com em runtime (bom para LCP, para CSP e para a
 * LGPD — nenhum IP de titular vai para um terceiro só por carregar uma fonte).
 * `display: 'swap'` evita texto invisível enquanto a fonte carrega (CLS controlado
 * pelo ajuste automático de métricas do próprio next/font).
 */
const hankenGrotesk = Hanken_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-hanken-grotesk',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

export const metadata: Metadata = {
  metadataBase: new URL(publicEnv.siteUrl),
  title: {
    default: 'MOVIVO — Ciência que treina com você',
    template: '%s · MOVIVO',
  },
  description:
    'Orientação de treino conversacional no WhatsApp, com protocolo calculado por motor determinístico e supervisionado por profissional de Educação Física registrado no CREF.',
  applicationName: 'MOVIVO',
  authors: [{ name: 'MOVIVO' }],
  /*
   * Esta é a casca técnica da Sprint 0, não a landing. Indexá-la só geraria um
   * resultado de busca que contradiz o produto. O `noindex` sai na Sprint 1, quando
   * a landing real de Helena/Sofia nascer.
   */
  robots: { index: false, follow: false },
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    siteName: 'MOVIVO',
    title: 'MOVIVO — Ciência que treina com você',
    description:
      'Orientação de treino conversacional no WhatsApp, com supervisão de profissional de Educação Física registrado no CREF.',
  },
};

export const viewport: Viewport = {
  /* O par cromático da marca: Névoa no tema claro, Petróleo Vivo no escuro. */
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f7f3' },
    { media: '(prefers-color-scheme: dark)', color: '#06302a' },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    /*
     * `lang="pt-BR"` é requisito de acessibilidade (WCAG 3.1.1): define a pronúncia
     * do leitor de tela. `suppressHydrationWarning` é exigido pelo next-themes, que
     * escreve a classe de tema no <html> antes do React hidratar.
     */
    <html lang="pt-BR" suppressHydrationWarning>
      <body className={`${hankenGrotesk.variable} ${jetbrainsMono.variable}`}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}

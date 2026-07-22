import { APP_VERSION, API_VERSION_PREFIX } from '@movivo/shared';

import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { isAnalyticsEnabled, publicEnv } from '@/lib/env';

/**
 * Home — Server Component (RSC).
 *
 * Não há `'use client'` aqui: a página inteira é renderizada no servidor e nenhum
 * byte deste arquivo vira JavaScript no browser. Os únicos client components da
 * árvore são o `ThemeProvider` (script anti-FOUC) e o `ThemeToggle` (precisa de
 * `onClick`) — a fronteira RSC/cliente é exatamente onde deve estar.
 *
 * O conteúdo é deliberadamente uma página de FUNDAÇÃO, não a landing: as telas de
 * produto (landing, anamnese em 3 blocos, dashboard CREF) são das Sprints 1+, com os
 * wireframes de Sofia. Escrever copy de produto aqui criaria uma fonte de verdade
 * paralela e provavelmente conflitante.
 */
export default function HomePage() {
  /*
   * `process.versions.node` só existe no servidor — é a prova de RSC mais direta que
   * existe: se este componente virasse client component, esta linha quebraria.
   */
  const nodeRuntime = process.versions.node;

  const fundacao = [
    { rotulo: 'Versão (@movivo/shared)', valor: APP_VERSION },
    { rotulo: 'Prefixo da API', valor: API_VERSION_PREFIX },
    { rotulo: 'Base da API', valor: publicEnv.apiUrl },
    { rotulo: 'Ambiente', valor: publicEnv.appEnv },
    { rotulo: 'Node (servidor)', valor: nodeRuntime },
    { rotulo: 'Analytics (PostHog)', valor: isAnalyticsEnabled ? 'ativo' : 'inativo (sem key)' },
  ];

  return (
    <>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:text-label focus:ring-[3px] focus:ring-ring"
      >
        Pular para o conteúdo
      </a>

      <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-12 px-6 py-10">
        <header className="flex items-center justify-between gap-4">
          <p className="font-mono text-label tracking-wide text-muted-foreground">
            movivo · sprint 0
          </p>
          <ThemeToggle />
        </header>

        <main id="conteudo" className="flex flex-1 flex-col gap-12">
          <section className="flex flex-col gap-4">
            <h1 className="text-h1 font-bold sm:text-display">MOVIVO</h1>
            <p className="text-h3 text-muted-foreground">Ciência que treina com você.</p>
            <p className="max-w-prose text-body">
              Orientação de treino conversacional no WhatsApp. O protocolo é calculado por um motor
              determinístico e supervisionado por um profissional de Educação Física registrado no
              CREF, que usa a IA como ferramenta de linguagem — nunca como quem decide sozinha.
            </p>
            <p
              className="max-w-prose rounded-lg border border-border bg-card p-4 text-label text-card-foreground"
              role="note"
            >
              Esta página é a <strong>fundação técnica</strong> da Sprint 0 (US-0.5): a casca do
              frontend. As telas de produto chegam nas próximas sprints, a partir dos wireframes de
              UX.
            </p>
          </section>

          <section aria-labelledby="titulo-design-system" className="flex flex-col gap-4">
            <h2 id="titulo-design-system" className="text-h2 font-semibold">
              Design system &ldquo;O Pulso&rdquo;
            </h2>
            <p className="max-w-prose text-body text-muted-foreground">
              Os tokens de marca (Petróleo Vivo, Verde Pulso, Coral Vivo, Névoa, Grafite e Musgo)
              alimentam o tema do Tailwind e as CSS variables do shadcn/ui, em tema claro e escuro.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button>Ação primária</Button>
              <Button variant="outline">Ação secundária</Button>
              <Button variant="destructive">Alerta gentil</Button>
              <Button variant="ghost">Discreta</Button>
            </div>
          </section>

          <section aria-labelledby="titulo-fundacao" className="flex flex-col gap-4">
            <h2 id="titulo-fundacao" className="text-h2 font-semibold">
              Integração do monorepo
            </h2>
            <p className="max-w-prose text-body text-muted-foreground">
              Os dois primeiros valores vêm de <code className="font-mono">@movivo/shared</code>, o
              pacote de contratos compartilhado com o backend.
            </p>
            <dl className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
              {fundacao.map((item) => (
                <div key={item.rotulo} className="flex flex-col gap-1 bg-card p-4">
                  <dt className="text-label text-muted-foreground">{item.rotulo}</dt>
                  <dd className="font-mono text-body break-all text-card-foreground">
                    {item.valor}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </main>

        <footer className="border-t border-border pt-6">
          <p className="font-mono text-label text-muted-foreground">
            Responsabilidade técnica · Profissional de Educação Física registrado — CREF
          </p>
        </footer>
      </div>
    </>
  );
}

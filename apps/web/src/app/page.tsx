import { GoalCta } from '@/components/goal-cta';
import { ThemeToggle } from '@/components/theme-toggle';

/**
 * Landing page (US-1.5) — Server Component (RSC).
 *
 * Renderizada no servidor; o único client component da árvore é `GoalCta` (chips de
 * pré-qualifying + CTA + analytics), exatamente onde a interatividade começa. Segue o
 * wireframe de Sofia §9.1 e os guardrails de linguagem (CLAUDE.md): nenhuma promessa
 * de resultado, sem termos proibidos, respaldo CREF sempre visível e a IA nunca
 * apresentada como quem decide sozinha.
 */
const PASSOS = [
  { n: '1', texto: 'Você conta sobre você e seus objetivos.' },
  {
    n: '2',
    texto:
      'Um treino é montado e revisado por um profissional de Educação Física registrado no CREF, que usa a IA como ferramenta.',
  },
  { n: '3', texto: 'Ele chega no seu WhatsApp, e você conversa sempre que precisar.' },
];

export default function HomePage() {
  return (
    <>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-4 focus:py-2 focus:text-label focus:ring-[3px] focus:ring-ring"
      >
        Pular para o conteúdo
      </a>

      <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-16 px-6 py-8">
        <header className="flex items-center justify-between gap-4">
          <p className="flex items-center gap-2 font-mono text-label tracking-wide text-muted-foreground">
            <span aria-hidden="true" className="size-2.5 rounded-full bg-primary" />
            movivo
          </p>
          <ThemeToggle />
        </header>

        <main id="conteudo" className="flex flex-1 flex-col gap-16">
          <section className="flex flex-col gap-6">
            <h1 className="text-h1 font-bold sm:text-display">
              Treino de verdade,
              <br />
              no seu WhatsApp.
            </h1>
            <p className="max-w-prose text-h3 text-muted-foreground">
              Feito com ciência, adaptado a você, com um profissional de Educação Física registrado
              no CREF por trás.
            </p>

            <GoalCta />
          </section>

          <section aria-labelledby="titulo-como-funciona" className="flex flex-col gap-4">
            <h2 id="titulo-como-funciona" className="text-h2 font-semibold">
              Como funciona
            </h2>
            <ol className="flex flex-col gap-3">
              {PASSOS.map((passo) => (
                <li key={passo.n} className="flex items-start gap-4 rounded-lg bg-card p-4">
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent font-mono text-label font-semibold text-accent-foreground"
                  >
                    {passo.n}
                  </span>
                  <p className="text-body text-card-foreground">{passo.texto}</p>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="titulo-prova" className="flex flex-col gap-4">
            <h2 id="titulo-prova" className="text-h2 font-semibold">
              Quem já treina com a MOVIVO
            </h2>
            <blockquote className="max-w-prose rounded-lg border border-border bg-card p-5 text-body text-card-foreground">
              <p>
                &ldquo;Nunca tinha conseguido manter uma rotina. Ter alguém para tirar dúvida na
                hora, no WhatsApp, mudou tudo para mim.&rdquo;
              </p>
              <footer className="mt-3 text-label text-muted-foreground">
                — pessoa treinando há 3 meses com a MOVIVO
              </footer>
            </blockquote>
          </section>
        </main>

        <footer className="flex items-start gap-3 border-t border-border pt-6">
          <span aria-hidden="true" className="text-h3 leading-none">
            🛡
          </span>
          <p className="font-mono text-label text-muted-foreground">
            Responsabilidade técnica de profissional de Educação Física registrado no CREF. A IA é
            ferramenta de apoio — a orientação é sempre supervisionada por um profissional.
          </p>
        </footer>
      </div>
    </>
  );
}

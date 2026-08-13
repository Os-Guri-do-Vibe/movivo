import { CalendarClock } from 'lucide-react';

/**
 * Tela de setor ainda não construído (US-7.7 / TASK-7.7.4).
 *
 * Honestidade em vez de fachada: o item existe no menu, abre, e explica **o que vai
 * existir**, **de que depende** e **quando chega**. Nenhum controle não-funcional é
 * exposto — botão que não faz nada é pior do que ausência de botão.
 *
 * Server Component: texto estático, sem estado.
 */
export function RoadmapSector({
  title,
  sprint,
  what,
  dependency,
}: {
  title: string;
  sprint: string;
  what: string;
  dependency: string;
}) {
  return (
    <div>
      <header>
        <h1 className="text-h1 font-bold">{title}</h1>
        <p className="mt-2 flex items-center gap-2 text-label text-muted-foreground">
          <CalendarClock aria-hidden="true" className="size-4" />
          Previsto para a {sprint}
        </p>
      </header>
      <section className="mt-6 grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-dashed border-border bg-card p-5">
          <h2 className="text-h3 font-semibold">O que vai existir aqui</h2>
          <p className="mt-2 text-body text-muted-foreground">{what}</p>
        </article>
        <article className="rounded-xl border border-dashed border-border bg-card p-5">
          <h2 className="text-h3 font-semibold">Do que depende</h2>
          <p className="mt-2 text-body text-muted-foreground">{dependency}</p>
        </article>
      </section>
    </div>
  );
}

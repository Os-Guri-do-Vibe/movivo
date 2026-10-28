import Link from 'next/link';

const LINKS = [
  { href: '/hoje', label: 'Treino' },
  { href: '/alimentacao', label: 'Alimentação' },
  { href: '/evolucao', label: 'Evolução' },
] as const;

/** Navegação entre as páginas do aluno (todas usam a mesma sessão do link mágico). */
export function StudentNav({ current }: { current: (typeof LINKS)[number]['href'] }) {
  return (
    <nav aria-label="Seções" className="flex gap-2 border-b border-border pb-3">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={link.href === current ? 'page' : undefined}
          className={`rounded-lg px-3 py-2 text-label font-semibold ${link.href === current ? 'bg-primary text-primary-foreground' : 'border border-border'}`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

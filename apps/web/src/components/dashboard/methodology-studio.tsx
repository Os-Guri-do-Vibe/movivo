'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { listDomains, type MethodologyDomainSummary } from '@/lib/methodology-studio-api';

const OWNER_LABEL: Record<MethodologyDomainSummary['owner'], string> = {
  CREF: 'Educação Física',
  CRN: 'Nutrição',
  CREF_CRN: 'Educação Física e Nutrição',
};

/** Lista dos domínios de metodologia com a versão publicada e o rascunho aberto. */
export function MethodologyStudio() {
  const [domains, setDomains] = useState<MethodologyDomainSummary[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    listDomains()
      .then(setDomains)
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Não foi possível carregar.'),
      );
  }, []);

  return (
    <section aria-labelledby="studio-list-title">
      <h1 id="studio-list-title" className="text-h2 font-bold">
        Metodologia
      </h1>
      <p className="mt-1 max-w-2xl text-label text-muted-foreground">
        O que os agentes da MOVIVO seguem. Cada domínio é escrito pelo profissional responsável,
        testado contra os casos de referência e só então publicado.
      </p>
      {error ? (
        <p
          role="alert"
          className="mt-5 rounded-xl border border-coral bg-coral/10 p-4 text-label font-medium"
        >
          {error}
        </p>
      ) : null}
      <ul className="mt-6 grid gap-3 md:grid-cols-2">
        {(domains ?? []).map((d) => (
          <li key={d.domain}>
            <Link
              href={`/dashboard/ia/metodologia/${d.domain.toLowerCase()}`}
              className="group flex h-full items-start justify-between gap-3 rounded-xl border border-border bg-card p-4 hover:border-verde-pulso/60"
            >
              <span>
                <span className="text-label font-semibold">{d.title}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{d.description}</span>
                <span className="mt-2 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                  <span>{OWNER_LABEL[d.owner]}</span>
                  <span>
                    {d.publishedVersion ? `Publicada: v${d.publishedVersion}` : 'Nada publicado'}
                  </span>
                  {d.openDraft ? (
                    <span className="font-medium text-foreground">
                      Rascunho v{d.openDraft.version}
                      {d.openDraft.status === 'TESTING' ? ' aprovado nos testes' : ''}
                    </span>
                  ) : null}
                </span>
              </span>
              <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

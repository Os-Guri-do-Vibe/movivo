'use client';

import type { ChurnRisk } from '@movivo/shared';
import { AlertTriangle, Search, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';

import { getStudents } from '@/lib/control-center-api';

import {
  DataQuality,
  EmptyState,
  ResourceState,
  SectorHeader,
  useControlCenterResource,
} from './control-center-ui';

function visibleName(name: string | null): string {
  return name?.trim() || 'Nome não informado';
}

function visibleValue(value: string | null): string {
  return value?.trim() || 'Não informado';
}

/**
 * Risco **comercial** de cancelamento com os sinais nomeados (US-7.4, TASK-7.4.5).
 * Um número sozinho não gera ação; os sinais que dispararam, sim. Não é leitura sobre
 * a saúde da pessoa.
 */
export function ChurnRiskSignals({ risk }: { risk: ChurnRisk }) {
  if (risk.score === 0) {
    return (
      <p className="mt-4 text-xs text-muted-foreground">
        Sem sinal de risco de cancelamento no momento.
      </p>
    );
  }
  return (
    <div className="mt-4">
      <p className="text-label font-semibold">Risco de cancelamento: {risk.score} de 3 sinais</p>
      <ul className="mt-2 space-y-1">
        {risk.signals.map((signal) => (
          <li key={signal.code} className="flex items-start gap-2 text-xs text-muted-foreground">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            {signal.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Base de alunos — tela única (US-7.1, TASK-7.1.4) ordenada por risco de cancelamento
 * (US-7.4, TASK-7.4.5). O antigo "Suporte" é esta mesma tela sob `SUPPORT_READ`/
 * `STUDENTS_READ`: sem campo de saúde. O backend já não envia dado de saúde nesta
 * projeção nem na ficha de quem não tem a capacidade; `canReadHealth` só ajusta a copy.
 */
export function StudentsDashboard({ canReadHealth = false }: { canReadHealth?: boolean }) {
  const load = useCallback((signal?: AbortSignal) => getStudents(signal), []);
  const { data, error, forbidden, loading, refresh } = useControlCenterResource(load);
  const [query, setQuery] = useState('');
  const students = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('pt-BR');
    if (!normalized) return data?.data.students ?? [];
    return (data?.data.students ?? []).filter((student) =>
      [student.name, student.email, student.phoneNumber, student.status]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase('pt-BR').includes(normalized)),
    );
  }, [data, query]);

  if (!data) {
    return (
      <ResourceState
        loading={loading}
        error={error}
        forbidden={forbidden}
        onRetry={() => void refresh()}
      />
    );
  }

  return (
    <div>
      <SectorHeader
        title="Base de alunos"
        description={
          canReadHealth
            ? 'Cadastro, situação operacional e ficha completa, ordenados por risco de cancelamento.'
            : 'Cadastro e situação operacional, ordenados por risco de cancelamento. Dados de saúde não fazem parte deste acesso.'
        }
        meta={data.meta}
        refreshing={loading}
        onRefresh={() => void refresh()}
      />

      {error ? (
        <p role="alert" className="mt-4 rounded-lg border border-coral bg-card p-3 text-label">
          {error} Os dados abaixo são da última atualização concluída.
        </p>
      ) : null}

      <label className="mt-6 block max-w-xl text-label font-semibold">
        Buscar nos alunos autorizados
        <span className="mt-2 flex min-h-11 items-center gap-2 rounded-lg border border-input bg-background px-3 focus-within:ring-[3px] focus-within:ring-ring">
          <Search aria-hidden="true" className="size-4 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-label outline-none"
            placeholder="Nome, contato ou status"
          />
        </span>
      </label>

      {students.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title={query ? 'Nenhum aluno encontrado' : 'Nenhum aluno neste escopo'}
            description={
              query
                ? 'Ajuste a busca para ver outros resultados.'
                : 'A lista será preenchida quando houver alunos atribuídos a este acesso.'
            }
          />
        </div>
      ) : (
        <ul className="mt-6 grid gap-4 lg:grid-cols-2" aria-label="Alunos autorizados">
          {students.map((student) => (
            <li key={student.id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                  <UserRound aria-hidden="true" className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-h3 font-semibold">{visibleName(student.name)}</h2>
                  <p className="mt-1 truncate text-label text-muted-foreground">
                    {visibleValue(student.email)}
                  </p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {student.phoneNumber}
                  </p>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-label">
                <div className="rounded-lg bg-secondary p-3">
                  <dt className="text-xs text-muted-foreground">Cadastro</dt>
                  <dd className="mt-1 font-semibold">{student.status}</dd>
                </div>
                <div className="rounded-lg bg-secondary p-3">
                  <dt className="text-xs text-muted-foreground">Assinatura</dt>
                  <dd className="mt-1 font-semibold">{visibleValue(student.subscriptionStatus)}</dd>
                </div>
              </dl>
              <ChurnRiskSignals risk={student.churnRisk} />
              <Link
                href={`/dashboard/alunos/${student.id}`}
                className="mt-4 inline-flex min-h-11 items-center text-label font-semibold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
              >
                Abrir ficha do aluno
              </Link>
            </li>
          ))}
        </ul>
      )}
      <DataQuality notes={data.meta.dataQuality} />
    </div>
  );
}

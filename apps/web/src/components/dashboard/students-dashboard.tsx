'use client';

import type { ChurnRisk, ControlCenterStudentSummary } from '@movivo/shared';
import { AlertTriangle, Search } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { getStudents } from '@/lib/control-center-api';
import { cn } from '@/lib/utils';

import {
  CONTROL_H,
  FIELD_BOX,
  FOCUS_RING,
  FieldDivider,
  FilterBar,
  FilterField,
  FilterFieldset,
  FilterSelect,
  FilterSelectOption,
  ResultCount,
  SortableTh,
  StatusBadge,
  TBODY_ROW,
  TD,
  TD_NUM,
  THEAD_ROW,
  TableCard,
  TableEmptyRow,
  TableFooter,
  TablePagination,
  TableScroll,
} from './control-center-table';
import type { FilterChip, SortDirection } from './control-center-table';
import {
  EmptyState,
  ResourceState,
  SectorHeader,
  useControlCenterResource,
} from './control-center-ui';
import { formatPhone } from './protocol-anamnesis-answers';

const PAGE_SIZE = 50;

function visibleName(name: string | null): string {
  return name?.trim() || 'Nome não informado';
}

function visibleValue(value: string | null): string {
  return value?.trim() || 'Não informado';
}

/**
 * Plano por período (`07-relatorio-eduardo.md`): mensal/trimestral/semestral/anual —
 * sem tiering de features. `subscriptionPlan` é o plano CONTRATADO; durante o trial
 * (`subscriptionStatus === 'TRIALING'`) o rótulo é "Teste" independente do plano —
 * ninguém foi cobrado ainda, mostrar "Mensal" nessa hora seria enganoso.
 */
const PLAN_LABELS: Record<string, string> = {
  MONTHLY: 'Mensal',
  QUARTERLY: 'Trimestral',
  SEMIANNUAL: 'Semestral',
  ANNUAL: 'Anual',
};
const PLAN_FILTER_OPTIONS = ['Teste', 'Mensal', 'Trimestral', 'Semestral', 'Anual'] as const;

interface StudentFilters {
  query: string;
  status: '' | 'Ativo' | 'Desativado';
  plan: '' | (typeof PLAN_FILTER_OPTIONS)[number];
  enrolledFrom: string;
  enrolledTo: string;
}

const EMPTY_FILTERS: StudentFilters = {
  query: '',
  status: '',
  plan: '',
  enrolledFrom: '',
  enrolledTo: '',
};

function planLabel(student: ControlCenterStudentSummary): string {
  if (student.subscriptionStatus === 'TRIALING') return 'Teste';
  if (student.subscriptionPlan)
    return PLAN_LABELS[student.subscriptionPlan] ?? student.subscriptionPlan;
  return 'Não informado';
}

/**
 * "Ativo"/"Desativado" é do PLANO DE ASSINATURA (achado 2026-08-19, a pedido do
 * fundador) — não confundir com `users.status` (cadastro). Trial em andamento conta
 * como ativo: o aluno tem acesso à plataforma nesse período.
 */
function isSubscriptionActive(student: ControlCenterStudentSummary): boolean {
  return student.subscriptionStatus === 'ACTIVE' || student.subscriptionStatus === 'TRIALING';
}

function statusLabel(student: ControlCenterStudentSummary): 'Ativo' | 'Desativado' {
  return isSubscriptionActive(student) ? 'Ativo' : 'Desativado';
}

function formatEnrolledAt(value: string | null): string {
  if (!value) return 'Não informado';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Não informado'
    : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(date);
}

/**
 * `YYYY-MM-DD` (valor cru do `<input type="date">`) → `DD/MM/AAAA`, sem passar por
 * `Date`: `new Date('2026-08-01')` é meia-noite UTC e viraria 31/07 em São Paulo.
 */
function formatDay(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
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

type SortKey = 'name' | 'status' | 'plan' | 'phone' | 'email' | 'enrolledAt';

/**
 * Ordem das colunas (a pedido do fundador, 2026-08-19): o NOME abre a linha — é a
 * âncora de identificação e o único destino clicável. Status e plano vêm logo em
 * seguida por serem o que se filtra; contato e data fecham.
 */
const SORT_COLUMNS: ReadonlyArray<{ key: SortKey; label: string }> = [
  { key: 'name', label: 'Nome' },
  { key: 'status', label: 'Status' },
  { key: 'plan', label: 'Plano' },
  { key: 'phone', label: 'WhatsApp' },
  { key: 'email', label: 'E-mail' },
  { key: 'enrolledAt', label: 'Data de inscrição' },
];

function sortValue(student: ControlCenterStudentSummary, key: SortKey): string {
  switch (key) {
    case 'status':
      return statusLabel(student);
    case 'plan':
      return planLabel(student);
    case 'name':
      return visibleName(student.name);
    case 'phone':
      return student.phoneNumber;
    case 'email':
      return visibleValue(student.email);
    case 'enrolledAt':
      // ISO 8601 ordena igual a data real; ausente vira '' — sempre a mais antiga.
      return student.enrolledAt ?? '';
  }
}

/**
 * Base de alunos — tela única (US-7.1, TASK-7.1.4). O antigo "Suporte" é esta mesma
 * tela sob `SUPPORT_READ`/`STUDENTS_READ`: sem campo de saúde. O backend já não envia
 * dado de saúde nesta projeção nem na ficha de quem não tem a capacidade;
 * `canReadHealth` só ajusta a copy.
 *
 * Faixa de filtros com chips do que está aplicado (achado 2026-08-19, spec de Sofia)
 * + tabela ordenável por qualquer coluna — busca livre, status, plano e período
 * combinam entre si (E lógico).
 */
export function StudentsDashboard({ canReadHealth = false }: { canReadHealth?: boolean }) {
  const load = useCallback((signal?: AbortSignal) => getStudents(signal), []);
  const { data, error, forbidden, loading, refresh } = useControlCenterResource(load);
  // `form` é o rascunho editado nos campos; `applied` só muda ao clicar "Buscar" (ou
  // "Limpar filtro"/remover um chip, que sincronizam os dois) — padrão do AuditDashboard.
  const [form, setForm] = useState<StudentFilters>(EMPTY_FILTERS);
  const [applied, setApplied] = useState<StudentFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({
    key: 'enrolledAt',
    direction: 'desc',
  });
  const [page, setPage] = useState(1);

  function toggleSort(key: SortKey) {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' },
    );
  }

  function searchStudents(event: FormEvent) {
    event.preventDefault();
    setApplied(form);
  }

  function clearFilters() {
    setForm(EMPTY_FILTERS);
    setApplied(EMPTY_FILTERS);
  }

  /**
   * Remover um chip age no rascunho E no aplicado de uma vez: o chip representa o que
   * já está valendo, então tirá-lo tem que mudar a lista na hora — pedir "Buscar"
   * depois de clicar no × seria contraintuitivo.
   */
  function removeFilter(patch: Partial<StudentFilters>) {
    setForm((current) => ({ ...current, ...patch }));
    setApplied((current) => ({ ...current, ...patch }));
  }

  const allStudents = data?.data.students ?? [];
  const students = useMemo(() => {
    const normalized = applied.query.trim().toLocaleLowerCase('pt-BR');
    const filtered = (data?.data.students ?? []).filter((student) => {
      if (applied.status && statusLabel(student) !== applied.status) return false;
      if (applied.plan && planLabel(student) !== applied.plan) return false;
      if (applied.enrolledFrom || applied.enrolledTo) {
        // Sem data de inscrição não casa com nenhum filtro de período — não dá pra
        // afirmar que caiu dentro (nem fora) de um período que não se conhece.
        if (!student.enrolledAt) return false;
        const enrolledDay = student.enrolledAt.slice(0, 10);
        if (applied.enrolledFrom && applied.enrolledTo) {
          if (enrolledDay < applied.enrolledFrom || enrolledDay > applied.enrolledTo) return false;
        } else if (applied.enrolledFrom) {
          // Só "De" preenchido = data específica (achado 2026-08-19, a pedido do
          // fundador) — não um intervalo aberto "a partir dessa data".
          if (enrolledDay !== applied.enrolledFrom) return false;
        } else if (applied.enrolledTo) {
          if (enrolledDay !== applied.enrolledTo) return false;
        }
      }
      if (!normalized) return true;
      return [student.name, student.email, student.phoneNumber]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase('pt-BR').includes(normalized));
    });
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort(
      (a, b) => sortValue(a, sort.key).localeCompare(sortValue(b, sort.key), 'pt-BR') * direction,
    );
  }, [data, applied, sort]);

  /** Um chip por filtro APLICADO — o período conta como um filtro só. */
  const chips: FilterChip[] = (() => {
    const active: FilterChip[] = [];
    const query = applied.query.trim();
    if (query) {
      active.push({
        key: 'query',
        label: `Busca: "${query}"`,
        removeLabel: 'Remover filtro Busca',
        onRemove: () => removeFilter({ query: '' }),
      });
    }
    if (applied.status) {
      active.push({
        key: 'status',
        label: `Status: ${applied.status}`,
        removeLabel: 'Remover filtro Status',
        onRemove: () => removeFilter({ status: '' }),
      });
    }
    if (applied.plan) {
      active.push({
        key: 'plan',
        label: `Plano: ${applied.plan}`,
        removeLabel: 'Remover filtro Plano',
        onRemove: () => removeFilter({ plan: '' }),
      });
    }
    if (applied.enrolledFrom || applied.enrolledTo) {
      const period =
        applied.enrolledFrom && applied.enrolledTo
          ? `${formatDay(applied.enrolledFrom)} – ${formatDay(applied.enrolledTo)}`
          : formatDay(applied.enrolledFrom || applied.enrolledTo);
      active.push({
        key: 'period',
        label: `Período: ${period}`,
        removeLabel: 'Remover filtro Período de inscrição',
        onRemove: () => removeFilter({ enrolledFrom: '', enrolledTo: '' }),
      });
    }
    return active;
  })();

  // Nova busca ou ordenação volta pra página 1 — senão o aluno fica "perdido" numa
  // página que pode nem existir mais no recorte atual.
  useEffect(() => {
    setPage(1);
  }, [applied, sort]);

  const totalPages = Math.max(1, Math.ceil(students.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStudents = students.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const rangeStart = students.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(currentPage * PAGE_SIZE, students.length);

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
        title="Base de Alunos"
        description={
          canReadHealth
            ? 'Cadastro e situação de assinatura de todos os alunos, com ficha completa disponível por aluno.'
            : 'Cadastro e situação de assinatura de todos os alunos. Dados de saúde não fazem parte deste acesso.'
        }
        refreshing={loading}
        onRefresh={() => void refresh()}
      />

      {error ? (
        <p role="alert" className="mt-4 rounded-lg border border-coral bg-card p-3 text-label">
          {error} Os dados abaixo são da última atualização concluída.
        </p>
      ) : null}

      {allStudents.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Nenhum aluno neste escopo"
            description="A lista será preenchida quando houver alunos atribuídos a este acesso."
          />
        </div>
      ) : (
        <>
          <FilterBar
            label="Filtros da base de alunos"
            onSubmit={searchStudents}
            chips={chips}
            actions={
              <>
                {/*
                 * Sempre renderizado, mesmo sem filtro aplicado (a pedido do fundador):
                 * um botão que aparece e some é um botão que não se aprende a procurar.
                 * Sem filtro, clicar é um no-op — `clearFilters` já lida com isso.
                 */}
                {/*
                 * `CONTROL_H` nos dois: `size="sm"` nasce com `h-9` (36px) e ficava mais
                 * baixo que os campos ao lado, que usam 44/40px. `cn` (tailwind-merge)
                 * mantém a altura passada por último e preserva o resto do `size="sm"`
                 * (padding, gap, arredondamento) intocado.
                 */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={CONTROL_H}
                  onClick={clearFilters}
                >
                  Limpar filtro
                </Button>
                <Button type="submit" size="sm" className={CONTROL_H}>
                  <Search aria-hidden="true" />
                  Buscar
                </Button>
              </>
            }
          >
            {/*
             * Busca em linha própria, largura total (a pedido do fundador, 2026-08-19,
             * terceira rodada de ajuste de largura): dividir a faixa com Status/Plano/
             * Período sempre deixava a busca espremida na sobra (só 201px a 1280px, já
             * que os outros três campos têm piso fixo — abaixo dele o `<select>` de
             * status corta "Desativado" e o de plano corta "Trimestral"). Só alargar o
             * teto (`max-w`) não resolvia: a 1280–1440px a busca nunca CHEGAVA a bater
             * no teto, então subir o teto não mudava nada visível nessas larguras — o
             * gargalo real era o espaço da linha, não o limite de crescimento.
             *
             * `lg:w-full` ocupa a linha inteira e força os outros campos (Status, Plano,
             * Período) e os botões para a segunda linha via `flex-wrap` do `FilterBar` —
             * eles cabem confortavelmente ali (fixos, ~730px de 918px úteis a 1280px),
             * sem disputar espaço com a busca.
             */}
            <FilterField label="Buscar" className="lg:w-full">
              <span className={cn(FIELD_BOX, CONTROL_H)}>
                <Search aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                <input
                  type="search"
                  value={form.query}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, query: event.target.value }))
                  }
                  className="min-w-0 flex-1 bg-transparent text-label outline-none"
                  placeholder="Nome, WhatsApp, e-mail"
                />
              </span>
            </FilterField>

            <FilterField label="Status da assinatura" className="lg:w-32">
              <FilterSelect
                value={form.status}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    status: value as StudentFilters['status'],
                  }))
                }
              >
                <FilterSelectOption value="">Todos</FilterSelectOption>
                <FilterSelectOption value="Ativo">Ativo</FilterSelectOption>
                <FilterSelectOption value="Desativado">Desativado</FilterSelectOption>
              </FilterSelect>
            </FilterField>

            <FilterField label="Plano" className="lg:w-30">
              <FilterSelect
                value={form.plan}
                onValueChange={(value) =>
                  setForm((current) => ({
                    ...current,
                    plan: value as StudentFilters['plan'],
                  }))
                }
              >
                <FilterSelectOption value="">Todos</FilterSelectOption>
                {PLAN_FILTER_OPTIONS.map((option) => (
                  <FilterSelectOption key={option} value={option}>
                    {option}
                  </FilterSelectOption>
                ))}
              </FilterSelect>
            </FilterField>

            {/*
             * Um único campo para os dois extremos: é UM filtro, não dois.
             *
             * Sem ícone decorativo à esquerda (ao contrário da busca): cada `input[type=date]`
             * já desenha o próprio calendário nativo, e um terceiro ícone só roubava os ~24px
             * que os dois campos precisam para mostrar `DD/MM/AAAA` inteiro — abaixo de ~95px
             * de largura útil o Chrome corta o primeiro dígito do dia.
             *
             * `lg:w-100` = 400px (a pedido do fundador, 2026-08-19, segunda rodada de
             * alargamento: 232px → 288px → 400px). Medido, não estimado: a 1280px com a
             * navegação aberta havia 157px de sobra entre a borda direita do campo e o
             * grupo de botões (que fica fixo à direita via `ml-auto`); os 112px a mais
             * consomem a maior parte dela e ainda deixam ~45px de folga antes de forçar
             * uma terceira linha. Cada data sobe de 123px para 179px de largura útil.
             */}
            <FilterFieldset legend="Período de inscrição" className="lg:w-100">
              <span className={cn(FIELD_BOX, CONTROL_H)}>
                <input
                  type="date"
                  aria-label="Período de inscrição, de"
                  value={form.enrolledFrom}
                  max={form.enrolledTo || undefined}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, enrolledFrom: event.target.value }))
                  }
                  className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none [color-scheme:light] dark:[color-scheme:dark]"
                />
                <FieldDivider />
                <input
                  type="date"
                  aria-label="Período de inscrição, até"
                  value={form.enrolledTo}
                  min={form.enrolledFrom || undefined}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, enrolledTo: event.target.value }))
                  }
                  className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none [color-scheme:light] dark:[color-scheme:dark]"
                />
              </span>
            </FilterFieldset>
          </FilterBar>

          <TableCard>
            <TableScroll label="Tabela da base de alunos">
              <table className="w-full min-w-[820px] text-label">
                <thead>
                  <tr className={THEAD_ROW}>
                    {SORT_COLUMNS.map((column) => (
                      <SortableTh
                        key={column.key}
                        label={column.label}
                        active={sort.key === column.key}
                        direction={sort.direction}
                        onSort={() => toggleSort(column.key)}
                      />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageStudents.map((student) => (
                    <tr key={student.id} className={TBODY_ROW}>
                      <td className={TD}>
                        <Link
                          href={`/dashboard/alunos/${student.id}`}
                          className={cn(
                            'font-medium underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground',
                            FOCUS_RING,
                          )}
                        >
                          {visibleName(student.name)}
                        </Link>
                      </td>
                      <td className={TD}>
                        {/*
                         * `attention` (coral) em vez de `neutral` (a pedido do fundador,
                         * 2026-08-20): "Desativado" precisa se destacar na varredura da
                         * lista. Diverge do racional original do `StatusBadge` (coral
                         * reservado a alerta real, tipo SLA/PAR-Q bloqueado) — decisão
                         * deliberada só para esta coluna, não uma correção do componente.
                         */}
                        <StatusBadge
                          tone={isSubscriptionActive(student) ? 'positive' : 'attention'}
                        >
                          {statusLabel(student)}
                        </StatusBadge>
                      </td>
                      <td className={TD}>{planLabel(student)}</td>
                      <td className={cn(TD, 'font-mono text-xs whitespace-nowrap')}>
                        {formatPhone(student.phoneNumber)}
                      </td>
                      <td className={TD}>{visibleValue(student.email)}</td>
                      {/*
                       * `text-left` sobrepõe o `text-right` padrão de `TD_NUM` (a pedido
                       * do fundador, 2026-08-20) — só nesta coluna; `TD_NUM` continua
                       * alinhado à direita por padrão para futuras colunas numéricas.
                       */}
                      <td className={cn(TD_NUM, 'text-left')}>
                        {formatEnrolledAt(student.enrolledAt)}
                      </td>
                    </tr>
                  ))}
                  {students.length === 0 ? (
                    <TableEmptyRow colSpan={SORT_COLUMNS.length}>
                      Nenhum aluno encontrado para os filtros aplicados.
                    </TableEmptyRow>
                  ) : null}
                </tbody>
              </table>
            </TableScroll>

            <TableFooter>
              <ResultCount
                from={rangeStart}
                to={rangeEnd}
                total={students.length}
                noun="aluno(s)"
              />
              {totalPages > 1 ? (
                <TablePagination
                  label="Paginação da base de alunos"
                  page={currentPage}
                  totalPages={totalPages}
                  onPageChange={setPage}
                />
              ) : null}
            </TableFooter>
          </TableCard>
        </>
      )}
    </div>
  );
}

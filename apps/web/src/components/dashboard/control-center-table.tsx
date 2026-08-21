'use client';

import * as SelectPrimitive from '@radix-ui/react-select';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import type { FormEvent, ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Padrões de tabela e filtro do Control Center (achado 2026-08-19, spec de Sofia).
 *
 * Este arquivo é o irmão de `control-center-ui.tsx`: lá moram cartão de métrica,
 * cabeçalho de setor e estados de recurso; aqui mora tudo que compõe uma LISTA
 * — faixa de filtros, chips de filtro aplicado, tabela densa, rodapé e paginação.
 *
 * Nenhum token de cor ou de fonte novo é introduzido: o redesenho é de estrutura,
 * densidade e hierarquia. O que muda é peso, espaçamento e ordem — não pigmento.
 */

/** Anel de foco único do Control Center — mesmo padrão em todo controle focável. */
export const FOCUS_RING =
  'outline-none focus-visible:ring-[3px] focus-visible:ring-ring ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/** Altura de controle: 44px em toque (WCAG 2.5.5 AAA), 40px em ponteiro fino (lg:). */
export const CONTROL_H = 'h-11 lg:h-10';

/** Botão de ícone: 44px em toque (WCAG 2.5.5 AAA), 40px em ponteiro fino — irmão de `CONTROL_H`. */
export const ICON_BUTTON = 'size-11 lg:size-10';

/**
 * Caixa de campo de formulário. `border-input` (não `border-border`) porque um
 * limite de controle de formulário precisa de 3:1 de contraste (WCAG 1.4.11) —
 * `border-border` é só 1,33:1, decorativo. `rounded-md` pra casar com o Button
 * (`buttonVariants` usa `rounded-md`; `rounded-lg` desalinha na mesma linha).
 */
export const FIELD_BOX =
  'flex items-center gap-2 rounded-md border border-input bg-card px-3 ' +
  'focus-within:ring-[3px] focus-within:ring-ring focus-within:ring-offset-2 ' +
  'focus-within:ring-offset-background';

/**
 * Mesma caixa do `FIELD_BOX`, aplicada ao GATILHO de um combo.
 * Não usar cru: o caminho canônico é o `FilterSelect`, que já monta a caixa com o
 * rótulo do valor à esquerda e a seta à direita.
 */
export const FIELD_SELECT = 'w-full min-w-0 rounded-md border border-input bg-card px-3 text-label';

/** Rótulo de campo de filtro: hierarquia por PESO, não por sumir com o rótulo. */
export const FILTER_LABEL = 'text-xs font-medium text-muted-foreground';

/** Célula de corpo padrão — ~40px de altura de linha. */
export const TD = 'px-4 py-2.5 align-middle';

/** Célula de dado técnico (data, número): alinhada à direita, monoespaçada. */
export const TD_NUM = 'px-4 py-2.5 align-middle text-right font-mono text-xs whitespace-nowrap';

/* -------------------------------------------------------------------------- */
/* Status                                                                     */
/* -------------------------------------------------------------------------- */

export type StatusTone = 'positive' | 'neutral' | 'attention' | 'quiet';

/**
 * Coral (`attention`) é reservado a alerta REAL — SLA estourado, PAR-Q bloqueado.
 * "Sem assinatura" não é alerta: é um estado neutro da base.
 */
const DOT: Record<StatusTone, string> = {
  positive: 'bg-verde-pulso',
  neutral: 'bg-muted-foreground',
  attention: 'bg-coral',
  quiet: 'bg-border',
};

const SOLID: Record<StatusTone, string> = {
  positive: 'bg-accent text-accent-foreground',
  neutral: 'bg-secondary text-secondary-foreground',
  attention: 'bg-destructive text-destructive-foreground',
  quiet: 'border border-border text-muted-foreground',
};

/**
 * Selo de status. O RÓTULO carrega o significado; a cor só reforça (WCAG 1.4.1 —
 * nunca comunicar por cor sozinha).
 *
 * `dot`   dentro de tabela: ponto discreto + texto, sem competir com o nome do aluno.
 * `solid` fora de tabela (ex.: `MetricCard`): pill preenchido, `font-medium`.
 */
export function StatusBadge({
  tone,
  variant = 'dot',
  title,
  children,
}: {
  tone: StatusTone;
  variant?: 'dot' | 'solid';
  /**
   * Tooltip nativo, para quando o rótulo visível é uma forma curta de uma frase
   * mais longa. Opcional: badge cujo rótulo já é completo não passa nada.
   *
   * `title` e não `aria-label`: `<span>` sem `role` é mapeado como `role="generic"`,
   * e a ARIA proíbe nome acessível em role genérico (`aria-prohibited-attr`); além
   * disso `aria-label` SUBSTITUIRIA o texto visível como nome acessível — o oposto
   * do que se quer. A leitura por leitor de tela se resolve no call-site, com um
   * `sr-only` dentro do próprio badge.
   */
  title?: string;
  children: ReactNode;
}) {
  if (variant === 'solid') {
    return (
      <span
        title={title}
        className={cn(
          'inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium',
          SOLID[tone],
        )}
      >
        {children}
      </span>
    );
  }
  return (
    <span title={title} className="inline-flex items-center gap-2 whitespace-nowrap">
      <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', DOT[tone])} />
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Faixa de filtros                                                           */
/* -------------------------------------------------------------------------- */

export interface FilterChip {
  /** Chave estável do filtro (`status`, `plan`, …) — só para o React. */
  key: string;
  /** Texto visível, já formatado: `Status: Ativo`. */
  label: string;
  /** Nome acessível do botão de remover: `Remover filtro Status`. */
  removeLabel: string;
  onRemove: () => void;
}

/**
 * Faixa de filtros em duas camadas: controles em cima, chips do que está APLICADO
 * embaixo. A segunda camada só existe quando há filtro ativo — é ela que responde
 * "por que a lista está curta?" sem obrigar o operador a reler cada campo.
 *
 * Os chips carregam só a remoção PONTUAL (o `×` de cada um); limpar tudo é um botão
 * permanente da faixa de controles (`actions`), não um link que aparece e some junto
 * com os chips (a pedido do fundador, 2026-08-19).
 */
export function FilterBar({
  label,
  onSubmit,
  actions,
  chips,
  children,
}: {
  /** Nome acessível do `<form>`. */
  label: string;
  onSubmit: (event: FormEvent) => void;
  /**
   * Ações da faixa (ex.: "Limpar filtro" + "Buscar"), agrupadas à direita em `lg:`.
   * Elas nunca encolhem: quem cede espaço são os campos, nunca o alvo de clique.
   */
  actions: ReactNode;
  chips: readonly FilterChip[];
  children: ReactNode;
}) {
  return (
    <form
      aria-label={label}
      onSubmit={onSubmit}
      className="mt-6 rounded-xl border border-border bg-card"
    >
      <div className="flex flex-col gap-3 p-3 lg:flex-row lg:flex-wrap lg:items-end lg:gap-1.5">
        {children}
        <div className="flex shrink-0 items-center gap-2 lg:ml-auto">{actions}</div>
      </div>
      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-secondary pr-1 pl-2.5 text-xs text-secondary-foreground"
            >
              {chip.label}
              <button
                type="button"
                onClick={chip.onRemove}
                aria-label={chip.removeLabel}
                className={cn(
                  'inline-flex size-6 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-border',
                  FOCUS_RING,
                )}
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </form>
  );
}

/** Campo de filtro com um único controle — o `<label>` embrulha o controle. */
export function FilterField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span className={FILTER_LABEL}>{label}</span>
      {children}
    </label>
  );
}

/**
 * Campo de filtro com MAIS de um controle (ex.: período: "de" e "até"). Um `<label>`
 * não pode apontar para dois controles — daí `<fieldset>`/`<legend>`.
 * O `<legend>` fica fora do contexto flex de propósito: `display:flex` em `<fieldset>`
 * ainda tem comportamento irregular de layout entre navegadores.
 */
export function FilterFieldset({
  legend,
  className,
  children,
}: {
  legend: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <fieldset className={cn('m-0 min-w-0 border-0 p-0', className)}>
      <legend className={cn('p-0', FILTER_LABEL)}>{legend}</legend>
      <div className="mt-1.5">{children}</div>
    </fieldset>
  );
}

/**
 * Radix não aceita `value=""` num item de Select (é o valor reservado para "nada
 * selecionado", e o componente lança em runtime se um item usar string vazia). Os
 * filtros do Control Center, porém, representam "sem filtro" exatamente como `''` —
 * e "Todos" precisa ser um item de verdade, senão não há como VOLTAR pra ele.
 *
 * A ponte é este sentinela, aplicado nas duas direções (`FilterSelect` e
 * `FilterSelectOption`) para que a restrição do Radix nunca vaze para o call-site:
 * lá fora, "sem filtro" continua sendo `''`.
 */
const NO_FILTER = '__all__';
const toItemValue = (value: string) => (value === '' ? NO_FILTER : value);
const fromItemValue = (value: string) => (value === NO_FILTER ? '' : value);

/**
 * Combo da faixa de filtros — Radix Select no padrão shadcn/ui, não mais um
 * `<select>` nativo.
 *
 * Motivo da troca (a pedido do fundador, 2026-08-19): a lista do `<select>` nativo
 * abre CENTRADA na opção selecionada em Chromium — se "Desativado" está escolhido, o
 * menu nasce por cima do campo, cobrindo o rótulo. O esperado num painel de filtro é o
 * menu ancorado LOGO ABAIXO do gatilho. `position="popper"` entrega isso, com o Radix
 * virando para cima só quando de fato não há espaço embaixo.
 *
 * O que NÃO mudou: a caixa (`FIELD_SELECT`), a altura (`CONTROL_H`), o anel de foco
 * (`FOCUS_RING`) e o `ChevronDown` à direita. A troca é de mecanismo de abertura, não
 * de pele. O gatilho continua expondo `role="combobox"` e o Radix mantém de fábrica a
 * navegação por teclado do padrão (setas, Home/End, busca por digitação, Esc fecha).
 *
 * `className` ainda vence as classes embutidas (`cn` resolve pela última classe).
 */
export function FilterSelect({
  value,
  onValueChange,
  className,
  children,
}: {
  /** Valor controlado. `''` = sem filtro (ver `NO_FILTER`). */
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  /** Itens do menu — sempre `FilterSelectOption`. */
  children: ReactNode;
}) {
  return (
    <SelectPrimitive.Root
      value={toItemValue(value)}
      onValueChange={(next) => onValueChange(fromItemValue(next))}
    >
      <SelectPrimitive.Trigger
        className={cn(
          FIELD_SELECT,
          CONTROL_H,
          FOCUS_RING,
          'flex items-center justify-between gap-2',
          className,
        )}
      >
        {/* `Select.Value` descarta `className` de propósito — daí o wrapper truncar. */}
        <span className="min-w-0 truncate">
          <SelectPrimitive.Value />
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          /*
           * `popper` + `sideOffset` = menu ancorado abaixo do gatilho (o padrão
           * `item-aligned` é justamente o comportamento centrado que saiu daqui).
           * A largura acompanha o gatilho e a altura respeita a sobra de viewport,
           * ambas por variável do próprio Radix — nada de número mágico.
           */
          position="popper"
          sideOffset={4}
          className={cn(
            'z-50 max-h-[var(--radix-select-content-available-height)] w-[var(--radix-select-trigger-width)] min-w-[8rem]',
            'overflow-hidden rounded-md border border-border bg-card text-label shadow-lg',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          )}
        >
          <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

/**
 * Item do `FilterSelect`. `h-11` em toque (WCAG 2.5.5) e `lg:h-9` em ponteiro fino —
 * mesma lógica do `CONTROL_H`, um degrau mais compacto porque item de menu não é alvo
 * isolado. `data-[highlighted]` cobre mouse E teclado: o Radix marca com o mesmo
 * atributo o item sob o cursor e o item sob o foco de navegação.
 */
export function FilterSelectOption({ value, children }: { value: string; children: ReactNode }) {
  return (
    <SelectPrimitive.Item
      value={toItemValue(value)}
      className={cn(
        'relative flex h-11 cursor-default items-center rounded-sm pr-8 pl-2 outline-none select-none lg:h-9',
        'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
      )}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 flex items-center justify-center">
        <Check aria-hidden="true" className="size-4" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

/** Hairline vertical interna — separa dois controles dentro da mesma caixa. */
export function FieldDivider() {
  return <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />;
}

/* -------------------------------------------------------------------------- */
/* Tabela                                                                     */
/* -------------------------------------------------------------------------- */

/** Cartão que embrulha tabela + rodapé (contagem e paginação moram DENTRO dele). */
export function TableCard({ children }: { children: ReactNode }) {
  return <div className="mt-4 rounded-xl border border-border bg-card">{children}</div>;
}

/**
 * Área de rolagem horizontal da tabela. `tabIndex={0}` + `role="region"` porque um
 * container que rola precisa ser alcançável por teclado (WCAG 2.1.1).
 */
export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn('overflow-x-auto rounded-t-xl', FOCUS_RING)}
    >
      {children}
    </div>
  );
}

export type SortDirection = 'asc' | 'desc';

/**
 * Linha de cabeçalho: hairline embaixo + grade vertical entre as colunas (a pedido
 * do fundador, 2026-08-19). `divide-x` age nas CÉLULAS da linha, então precisa viver
 * no `<tr>`; a `<table>` herda `border-collapse: collapse` do preflight, o que funde
 * a divisória do cabeçalho com a do corpo numa hairline só.
 */
export const THEAD_ROW = 'divide-x divide-border border-b border-border';

/** Linha de corpo: mesma grade vertical; hover E focus-within — teclado e toque não têm hover. */
export const TBODY_ROW =
  'divide-x divide-border border-b border-border transition-colors last:border-b-0 hover:bg-muted/60 focus-within:bg-muted/60';

/**
 * Cabeçalho ordenável. `font-medium` (nunca `font-semibold`): o cabeçalho é
 * metadado, o conteúdo da linha é o dado — inverter esses pesos é o que faz a
 * hierarquia da tabela colapsar. O ícone só aparece em hover/foco/coluna ativa.
 *
 * O TÍTULO é sempre centralizado (a pedido do fundador, 2026-08-19) — inclusive o de
 * coluna numérica/data, cujo CORPO segue alinhado à direita (`TD_NUM`): centralizar o
 * dado técnico quebraria a leitura em coluna de dígitos.
 */
export function SortableTh({
  label,
  active,
  direction,
  onSort,
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onSort: () => void;
}) {
  const Icon = !active ? ArrowUpDown : direction === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className="px-4 py-3 text-center text-xs font-medium whitespace-nowrap text-muted-foreground"
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          // Padding negativo: cria o alvo de toque sem inflar a altura da linha.
          'group -mx-2 -my-1.5 inline-flex items-center justify-center gap-1.5 rounded-sm px-2 py-1.5 transition-colors hover:text-foreground',
          active && 'text-foreground',
          FOCUS_RING,
        )}
      >
        {label}
        <Icon
          aria-hidden="true"
          className={cn(
            'size-3.5 transition-opacity',
            active
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-60 group-focus-visible:opacity-60',
          )}
        />
      </button>
    </th>
  );
}

/** Vazio de FILTRO — vive dentro do `<tbody>` pra não sumir do leitor de tela. */
export function TableEmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-label text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}

/** Rodapé do cartão: contagem à esquerda, paginação à direita. */
export function TableFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-border px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      {children}
    </div>
  );
}

const COUNT_NUM = 'font-mono tabular-nums text-foreground';

/**
 * Contagem do recorte atual. `aria-live="polite"` porque, para quem usa leitor de
 * tela, aplicar um filtro não muda o foco — sem o anúncio, nada informa que a lista
 * encolheu. Renderiza SEMPRE, inclusive com zero resultado.
 */
export function ResultCount({
  from,
  to,
  total,
  noun,
}: {
  from: number;
  to: number;
  total: number;
  /** Substantivo já pluralizado do item listado: `aluno(s)`. */
  noun: string;
}) {
  return (
    <p aria-live="polite" className="text-xs text-muted-foreground">
      {total === 0 ? (
        <>
          Mostrando <span className={COUNT_NUM}>0</span> de <span className={COUNT_NUM}>0</span>{' '}
          {noun}
        </>
      ) : (
        <>
          Mostrando <span className={COUNT_NUM}>{from}</span>–
          <span className={COUNT_NUM}>{to}</span> de <span className={COUNT_NUM}>{total}</span>{' '}
          {noun}
        </>
      )}
    </p>
  );
}

export function TablePagination({
  label,
  page,
  totalPages,
  onPageChange,
}: {
  /** Nome acessível da navegação — obrigatório se houver mais de uma na página. */
  label: string;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <nav aria-label={label} className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="Página anterior"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        <ChevronLeft aria-hidden="true" />
      </Button>
      <p className="font-mono text-xs text-muted-foreground tabular-nums">
        {page} / {totalPages}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label="Próxima página"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        <ChevronRight aria-hidden="true" />
      </Button>
    </nav>
  );
}

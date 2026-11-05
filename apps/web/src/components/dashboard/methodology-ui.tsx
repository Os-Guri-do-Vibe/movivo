import {
  agentTaskLabel,
  type DomainSpec,
  type FieldSpec,
  type MethodologyDocumentStatus,
} from '@movivo/shared';
import {
  BedDouble,
  CalendarCheck,
  Dumbbell,
  Flame,
  Footprints,
  MessageCircle,
  Shuffle,
  ShieldCheck,
  SlidersHorizontal,
  Salad,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';

/** Em que área do negócio cada domínio mora na listagem (agrupa 10 itens em 3 blocos). */
export const DOMAIN_GROUPS = [
  {
    key: 'training',
    title: 'Modalidades de treino',
    domains: ['STRENGTH', 'RUNNING', 'HYROX', 'HYBRID'],
  },
  { key: 'nutrition', title: 'Alimentação e recuperação', domains: ['NUTRITION', 'RECOVERY'] },
  {
    key: 'rules',
    title: 'Acompanhamento e regras da IA',
    domains: ['ADHERENCE', 'SAFETY', 'AUTONOMY', 'COMMUNICATION'],
  },
] as const;

export const DOMAIN_ICONS: Readonly<Record<string, LucideIcon>> = {
  STRENGTH: Dumbbell,
  RUNNING: Footprints,
  HYROX: Flame,
  HYBRID: Shuffle,
  NUTRITION: Salad,
  RECOVERY: BedDouble,
  ADHERENCE: CalendarCheck,
  SAFETY: ShieldCheck,
  AUTONOMY: SlidersHorizontal,
  COMMUNICATION: MessageCircle,
};

export const OWNER_LABEL: Readonly<Record<DomainSpec['owner'], string>> = {
  CREF: 'Educação Física',
  CRN: 'Nutrição',
  CREF_CRN: 'Educação Física e Nutrição',
};

/**
 * Largura da área de conteúdo: centralizada, com margens iguais, também em telas ultrawide. É um
 * `@container`: o layout responde ao espaço que o conteúdo realmente tem (com o menu lateral aberto
 * ele é bem menor que a janela), não à largura da janela.
 */
export const PAGE_CONTAINER = '@container mx-auto w-full max-w-[68rem]';

type Tone = 'live' | 'ready' | 'draft' | 'attention' | 'muted';

/** O ponto colore o estado; o texto sempre o diz (nunca só cor). */
const DOT_CLASS: Record<Tone, string> = {
  live: 'bg-verde-pulso',
  ready: 'bg-verde-pulso',
  draft: 'bg-muted-foreground',
  attention: 'bg-coral',
  muted: 'border border-muted-foreground',
};

export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap text-foreground',
        tone === 'muted' && 'text-muted-foreground',
        className,
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', DOT_CLASS[tone])} />
      {children}
    </span>
  );
}

const DOCUMENT_STATUS: Record<MethodologyDocumentStatus, { tone: Tone; label: string }> = {
  PUBLISHED: { tone: 'live', label: 'Em vigor' },
  TESTING: { tone: 'ready', label: 'Testada, pronta para publicar' },
  DRAFT: { tone: 'draft', label: 'Rascunho' },
  SUPERSEDED: { tone: 'muted', label: 'Versão anterior' },
  DISCARDED: { tone: 'muted', label: 'Descartada' },
};

export function DocumentStatusBadge({ status }: { status: MethodologyDocumentStatus }) {
  const { tone, label } = DOCUMENT_STATUS[status];
  return <StatusBadge tone={tone}>{label}</StatusBadge>;
}

/** Nome legível da tarefa testada (a tradução vive no pacote compartilhado, igual à da API). */
export const agentLabelOfTask = agentTaskLabel;

const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dateFormat.format(date);
}

/** Valor de um campo em linguagem de gente: "10 a 16", "Sim", "1 · 2 · 3". */
export function formatValue(value: unknown, field?: FieldSpec): string {
  if (value === null || value === undefined || value === '') return 'vazio';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    const option =
      field && (field.kind === 'choice' || field.kind === 'multiChoice')
        ? field.options.find((o) => o.value === value)
        : undefined;
    return option?.label ?? value;
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? 'nenhum' : value.map((item) => formatValue(item, field)).join(', ');
  }
  if (typeof value === 'object') {
    const range = value as { min?: unknown; max?: unknown };
    if (typeof range.min === 'number' && typeof range.max === 'number') {
      return `${range.min} a ${range.max}`;
    }
    return JSON.stringify(value);
  }
  return String(value);
}

export interface ReadableChange {
  key: string;
  /** Onde: "Volume · Séries por grupo muscular". */
  where: string;
  /** Qual linha/coluna, quando o campo é uma tabela: "Iniciante · Séries/semana". */
  detail?: string;
  before: string;
  after: string;
}

/**
 * Transforma as mudanças da API (um item por campo) em linhas legíveis. Tabelas são abertas
 * célula a célula para o profissional ver exatamente o que mudou, e não um bloco inteiro.
 */
export function readableChanges(
  spec: DomainSpec,
  changes: readonly { path: string; label: string; before: unknown; after: unknown }[],
): ReadableChange[] {
  return changes.flatMap((change) => {
    const [sectionKey, fieldKey] = change.path.split('.');
    const section = spec.sections.find((s) => s.key === sectionKey);
    const field = section && fieldKey ? section.fields[fieldKey] : undefined;
    const where = section ? `${section.title} · ${change.label}` : change.label;

    if (field?.kind === 'table') {
      const before = (change.before ?? {}) as Record<string, Record<string, unknown>>;
      const after = (change.after ?? {}) as Record<string, Record<string, unknown>>;
      return field.rows.flatMap((row) =>
        Object.entries(field.columns).flatMap(([columnKey, column]) => {
          const a = before[row.key]?.[columnKey];
          const b = after[row.key]?.[columnKey];
          if (JSON.stringify(a) === JSON.stringify(b)) return [];
          return [
            {
              key: `${change.path}.${row.key}.${columnKey}`,
              where,
              detail: `${row.label} · ${column.label}`,
              before: formatValue(a, column),
              after: formatValue(b, column),
            },
          ];
        }),
      );
    }
    return [
      {
        key: change.path,
        where,
        before: formatValue(change.before, field),
        after: formatValue(change.after, field),
      },
    ];
  });
}

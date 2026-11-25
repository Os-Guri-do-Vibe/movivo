/**
 * Renderiza um documento de metodologia em texto para o prompt dos agentes: cada parâmetro com
 * o rótulo e a unidade que o profissional viu no estúdio, seguido das orientações em texto.
 * O agente recebe exatamente o que foi publicado — nenhuma regra fica só no código.
 */
import type { ColumnSpec, DomainSpec, FieldSpec, MethodologyParameters } from '@movivo/shared';

function formatValue(field: ColumnSpec | FieldSpec, value: unknown): string {
  const unit = 'unit' in field && field.unit ? ` ${field.unit}` : '';
  switch (field.kind) {
    case 'number':
      return `${String(value)}${unit}`;
    case 'range': {
      const range = value as { min: number; max: number };
      return range.min === range.max ? `${range.min}${unit}` : `${range.min}–${range.max}${unit}`;
    }
    case 'boolean':
      return value ? 'sim' : 'não';
    case 'choice':
      return field.options.find((o) => o.value === value)?.label ?? String(value);
    case 'multiChoice':
      return (value as string[])
        .map((v) => field.options.find((o) => o.value === v)?.label ?? v)
        .join(', ');
    case 'text':
      return String(value);
    case 'textList':
      return (value as string[]).join('; ');
    case 'table':
      return '';
  }
}

/**
 * Um campo que entrou na especificação DEPOIS da publicação não existe no documento publicado
 * (ele só passa a existir quando o profissional publicar a próxima versão). O agente recebe
 * exatamente o que foi publicado, então o campo ausente simplesmente não aparece: nunca derruba
 * a geração nem vira "undefined" no prompt.
 */
const missing = (value: unknown) => value === undefined || value === null;

function renderField(field: FieldSpec, value: unknown): string[] {
  if (missing(value)) return [];
  if (field.kind !== 'table') return [`- ${field.label}: ${formatValue(field, value)}`];
  const rows = value as Record<string, Record<string, unknown>>;
  const lines: string[] = [];
  for (const row of field.rows) {
    const cells = Object.entries(field.columns).flatMap(([key, column]) => {
      const published = rows[row.key]?.[key];
      if (missing(published)) return [];
      const cell = formatValue(column, published);
      return [Object.keys(field.columns).length === 1 ? cell : `${column.label}: ${cell}`];
    });
    if (cells.length > 0) lines.push(`  - ${row.label}: ${cells.join('; ')}`);
  }
  return lines.length > 0 ? [`- ${field.label}:`, ...lines] : [];
}

export function renderMethodology(
  spec: DomainSpec,
  version: number,
  parameters: MethodologyParameters,
  guidance: Record<string, string>,
): string {
  const lines: string[] = [`## ${spec.title} (versão ${version})`];
  for (const section of spec.sections) {
    lines.push(`### ${section.title}`);
    for (const [key, field] of Object.entries(section.fields)) {
      lines.push(...renderField(field, parameters[section.key]?.[key]));
    }
  }
  for (const item of spec.guidance) {
    const text = guidance[item.key]?.trim();
    if (text) lines.push(`### ${item.title}`, text);
  }
  return lines.join('\n');
}

/** Diferença campo a campo entre duas versões (para o profissional revisar antes de publicar). */
export interface MethodologyChange {
  path: string;
  label: string;
  before: unknown;
  after: unknown;
}

export function diffMethodology(
  spec: DomainSpec,
  before: MethodologyParameters | null,
  after: MethodologyParameters,
): MethodologyChange[] {
  const changes: MethodologyChange[] = [];
  for (const section of spec.sections) {
    for (const [key, field] of Object.entries(section.fields)) {
      const a = before?.[section.key]?.[key];
      const b = after[section.key]?.[key];
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        changes.push({
          path: `${section.key}.${key}`,
          label: field.label,
          before: a ?? null,
          after: b,
        });
      }
    }
  }
  return changes;
}

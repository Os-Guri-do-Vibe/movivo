/**
 * Traduz os erros de validação (Zod) do estúdio de metodologia para frases que o profissional
 * entende: o nome do campo como aparece na tela, e o motivo em português.
 */
import type { DomainSpec, FieldSpec } from '@movivo/shared';

export interface ReadableIssue {
  /** Caminho técnico do campo (`secao.campo.linha.coluna`), útil para destacar na tela. */
  path: string;
  /** Frase pronta para exibir: "Duração de um bloco por fase · Adaptação: não foi preenchido." */
  message: string;
}

/** Forma mínima de um erro do Zod 4 que a tradução lê. */
export interface RawIssue {
  code: string;
  path: readonly PropertyKey[];
  message: string;
  input?: unknown;
  minimum?: number | bigint;
  maximum?: number | bigint;
  keys?: string[];
}

const BOUND_LABEL: Readonly<Record<string, string>> = { min: 'mínimo', max: 'máximo' };

function unitOf(field: FieldSpec | undefined): string {
  if (field && (field.kind === 'number' || field.kind === 'range') && field.unit) {
    return ` ${field.unit}`;
  }
  return '';
}

/** Percorre seção → campo → linha → coluna e devolve os nomes legíveis e o campo final. */
function locate(spec: DomainSpec | undefined, path: readonly PropertyKey[]) {
  const names: string[] = [];
  let field: FieldSpec | undefined;
  const [sectionKey, fieldKey, ...rest] = path.map(String);
  const section = spec?.sections.find((s) => s.key === sectionKey);
  if (section) names.push(section.title);
  else if (sectionKey) names.push(sectionKey);
  if (fieldKey) {
    field = section?.fields[fieldKey];
    names.push(field?.label ?? fieldKey);
  }
  let current = field;
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i] ?? '';
    if (current?.kind === 'table') {
      const row = current.rows.find((r) => r.key === key);
      if (row) {
        names.push(row.label);
        const column = rest[i + 1] ? current.columns[rest[i + 1] ?? ''] : undefined;
        if (column) {
          names.push(column.label);
          current = column;
          i += 1;
        }
        continue;
      }
    }
    if (current?.kind === 'range' && BOUND_LABEL[key]) {
      names.push(BOUND_LABEL[key]);
      continue;
    }
    names.push(key);
  }
  return { names, field: current };
}

function reasonOf(issue: RawIssue, unit: string): string {
  switch (issue.code) {
    case 'invalid_type':
      // O Zod 4 não devolve o valor recebido no erro; só a mensagem ("..., received undefined").
      return issue.input === undefined && /received undefined$/.test(issue.message)
        ? 'não foi preenchido'
        : 'está em um formato que não é aceito (confira se é um número)';
    case 'too_small':
      return `está abaixo do limite mínimo${issue.minimum === undefined ? '' : ` de ${issue.minimum}${unit}`}`;
    case 'too_big':
      return `está acima do limite máximo${issue.maximum === undefined ? '' : ` de ${issue.maximum}${unit}`}`;
    case 'invalid_value':
      return 'não é uma das opções disponíveis';
    case 'unrecognized_keys':
      return `traz informações que não existem aqui${issue.keys?.length ? ` (${issue.keys.join(', ')})` : ''}`;
    case 'custom':
      // As regras próprias do domínio (ex.: mínimo maior que o máximo) já vêm em português.
      return issue.message.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase());
    default:
      return 'não é um valor válido';
  }
}

export function readableIssue(spec: DomainSpec | undefined, issue: RawIssue): ReadableIssue {
  const { names, field } = locate(spec, issue.path);
  const where = names.length > 0 ? names.join(' · ') : 'Dados enviados';
  return {
    path: issue.path.map(String).join('.'),
    message: `${where}: ${reasonOf(issue, unitOf(field))}.`,
  };
}

export function readableIssues(
  spec: DomainSpec | undefined,
  issues: readonly RawIssue[],
): ReadableIssue[] {
  return issues.map((issue) => readableIssue(spec, issue));
}

const BODY_FIELD_LABEL: Readonly<Record<string, string>> = {
  guidance: 'Orientações',
  justifications: 'Justificativas',
  changeNote: 'Descrição da mudança',
  fromVersion: 'Versão de origem',
};

/**
 * Erros do corpo da requisição de edição: os valores ficam em `parameters` (traduzidos pelo
 * domínio) e os demais campos têm nome próprio na tela.
 */
export function readableBodyIssues(
  spec: DomainSpec | undefined,
  issues: readonly RawIssue[],
): ReadableIssue[] {
  return issues.map((issue) => {
    const [head, ...rest] = issue.path;
    if (head === 'parameters') return readableIssue(spec, { ...issue, path: rest });
    const label = BODY_FIELD_LABEL[String(head)];
    if (!label) return readableIssue(undefined, issue);
    const reason = readableIssue(undefined, { ...issue, path: [] }).message.replace(
      /^Dados enviados: /,
      '',
    );
    return { path: issue.path.map(String).join('.'), message: `${label}: ${reason}` };
  });
}

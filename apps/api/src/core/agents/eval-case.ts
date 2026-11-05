/**
 * Casos de avaliação de uma tarefa de agente e o motor de asserções.
 *
 * Um caso fixa o Estado do Aluno (fatias), a metodologia e a entrada; as asserções dizem o que
 * a saída PRECISA ter. Preferência por asserção determinística (`path`, `check`); o juiz por
 * rubrica (`judge`) só onde nenhuma checagem objetiva é possível.
 */
import type { MethodologyDomain, StateSlice } from './agent-task';

export type PathOperator =
  | 'eq'
  | 'neq'
  | 'in'
  | 'notIn'
  | 'gte'
  | 'lte'
  | 'exists'
  | 'notExists'
  | 'contains'
  | 'notContains'
  | 'lengthGte'
  | 'lengthLte';

export type Assertion =
  | {
      kind: 'path';
      /** Caminho com pontos e índices (ex.: `sessions.0.content.modality`). `*` varre arrays. */
      path: string;
      op: PathOperator;
      value?: unknown;
      description: string;
    }
  | {
      kind: 'check';
      /** Checagem nomeada registrada pela tarefa (ex.: `noDislikedExercise`). */
      name: string;
      description: string;
    }
  | { kind: 'judge'; rubric: string; description: string };

export interface EvalCase {
  /** Slug estável (ex.: `hipertrofia-com-adiposidade-alta`). */
  id: string;
  taskId: string;
  title: string;
  /** Casos de segurança exigem 100% das asserções. */
  safetyCritical: boolean;
  /** Fração mínima de asserções aprovadas (0–1) para o caso passar. */
  minScore: number;
  state: Partial<Record<StateSlice, unknown>>;
  /** Texto de metodologia por domínio; ausente = versão publicada no momento da avaliação. */
  methodology?: Partial<Record<MethodologyDomain, string>>;
  input: unknown;
  /** Imagens (base64) das tarefas de visão. */
  images?: readonly { mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string }[];
  assertions: readonly Assertion[];
}

/** Checagens nomeadas: função pura da saída (e do caso) que devolve aprovado + motivo. */
export type NamedCheck = (output: unknown, evalCase: EvalCase) => { pass: boolean; detail: string };

export interface AssertionResult {
  description: string;
  pass: boolean;
  detail: string;
}

/** Valores no caminho (com `*` expandindo arrays). */
export function valuesAt(root: unknown, path: string): unknown[] {
  let current: unknown[] = [root];
  for (const segment of path.split('.').filter(Boolean)) {
    const next: unknown[] = [];
    for (const value of current) {
      if (value === null || typeof value !== 'object') continue;
      if (segment === '*') {
        if (Array.isArray(value)) next.push(...value);
        continue;
      }
      const child = (value as Record<string, unknown>)[segment];
      if (child !== undefined) next.push(child);
    }
    current = next;
  }
  return current;
}

function compare(op: PathOperator, actual: unknown, expected: unknown): boolean {
  switch (op) {
    case 'eq':
      return JSON.stringify(actual) === JSON.stringify(expected);
    case 'neq':
      return JSON.stringify(actual) !== JSON.stringify(expected);
    case 'in':
      return (
        Array.isArray(expected) &&
        expected.some((e) => JSON.stringify(e) === JSON.stringify(actual))
      );
    case 'notIn':
      return (
        Array.isArray(expected) &&
        !expected.some((e) => JSON.stringify(e) === JSON.stringify(actual))
      );
    case 'gte':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'lte':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case 'contains':
      return (
        (typeof actual === 'string' &&
          typeof expected === 'string' &&
          actual.toLowerCase().includes(expected.toLowerCase())) ||
        (Array.isArray(actual) &&
          actual.some((a) => JSON.stringify(a) === JSON.stringify(expected)))
      );
    case 'notContains':
      return !compare('contains', actual, expected);
    case 'lengthGte':
      return Array.isArray(actual) && typeof expected === 'number' && actual.length >= expected;
    case 'lengthLte':
      return Array.isArray(actual) && typeof expected === 'number' && actual.length <= expected;
    case 'exists':
    case 'notExists':
      return true;
  }
}

/**
 * Avalia uma asserção de caminho. Com `*`, TODOS os valores encontrados precisam passar (exceto
 * `contains`, que passa se ALGUM contém). Caminho sem valor falha, salvo `notExists`.
 */
export function evaluatePath(
  output: unknown,
  assertion: Extract<Assertion, { kind: 'path' }>,
): AssertionResult {
  const values = valuesAt(output, assertion.path);
  const base = { description: assertion.description };
  if (assertion.op === 'exists') {
    return { ...base, pass: values.length > 0, detail: `${values.length} valor(es)` };
  }
  if (assertion.op === 'notExists') {
    return { ...base, pass: values.length === 0, detail: `${values.length} valor(es)` };
  }
  if (values.length === 0) {
    return { ...base, pass: false, detail: `nada em ${assertion.path}` };
  }
  const pass =
    assertion.op === 'contains'
      ? values.some((v) => compare('contains', v, assertion.value))
      : values.every((v) => compare(assertion.op, v, assertion.value));
  return {
    ...base,
    pass,
    detail: `${assertion.path} ${assertion.op} ${JSON.stringify(assertion.value)} → ${JSON.stringify(values).slice(0, 200)}`,
  };
}

/** Nota do caso: fração de asserções aprovadas; segurança exige todas. */
export function scoreCase(
  evalCase: EvalCase,
  results: AssertionResult[],
): { score: number; pass: boolean } {
  const passed = results.filter((r) => r.pass).length;
  const score = results.length === 0 ? 0 : passed / results.length;
  const pass = evalCase.safetyCritical ? passed === results.length : score >= evalCase.minScore;
  return { score, pass };
}

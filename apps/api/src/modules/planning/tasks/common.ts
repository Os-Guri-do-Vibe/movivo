/**
 * Peças comuns às tarefas de planejamento: guardrails de linguagem, normalização de texto e
 * leitura segura das fatias do Estado do Aluno que os validadores precisam.
 */
import type { Violation } from '../../../core/agents/agent-task';

/** Remove acentos e baixa a caixa — comparação de texto livre em português. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * Termos que nunca aparecem em texto para o aluno (guardrails de linguagem da MOVIVO): nada de
 * diagnóstico, tratamento, cura ou promessa de resultado.
 */
const FORBIDDEN_PATTERNS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /\bdiagnostic/, label: 'diagnóstico' },
  { pattern: /\btratament/, label: 'tratamento' },
  { pattern: /\bcura(r|do|da|s)?\b/, label: 'cura' },
  { pattern: /resultado[s]? garantid/, label: 'resultado garantido' },
  { pattern: /\bgarant(e|imos|ido|ida|ia|imos)\b/, label: 'promessa garantida' },
  { pattern: /\bsem (nenhum )?risco\b/, label: 'promessa de ausência de risco' },
];

export function languageViolations(text: string, path: string): Violation[] {
  const folded = fold(text);
  return FORBIDDEN_PATTERNS.filter(({ pattern }) => pattern.test(folded)).map(({ label }) => ({
    path,
    message: `texto para o aluno não pode conter "${label}" (guardrail de linguagem)`,
  }));
}

/** Todas as strings de um valor JSON, com o caminho em que estão. */
export function stringsOf(value: unknown, path = ''): { path: string; text: string }[] {
  if (typeof value === 'string') return [{ path, text: value }];
  if (Array.isArray(value)) return value.flatMap((item, i) => stringsOf(item, `${path}.${i}`));
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) =>
      stringsOf(child, path ? `${path}.${key}` : key),
    );
  }
  return [];
}

/** Valida a linguagem de TODO texto da saída (a saída de planejamento é lida pelo aluno). */
export function outputLanguageViolations(output: unknown): Violation[] {
  return stringsOf(output).flatMap(({ path, text }) => languageViolations(text, path));
}

/** Fatia do estado como objeto (ou vazio): os validadores nunca podem quebrar por dado ausente. */
export function sliceOf<T extends object = Record<string, unknown>>(
  state: Record<string, unknown>,
  name: string,
): Partial<T> {
  const value = state[name];
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Partial<T>) : {};
}

export interface SafetyHealthRecord {
  kind: string;
  summary: string;
}

/** Registros de saúde decifrados da fatia `safety` (vazio sem consentimento). */
export function healthRecords(state: Record<string, unknown>): SafetyHealthRecord[] {
  const safety = sliceOf<{ healthRecords: SafetyHealthRecord[] }>(state, 'safety');
  return Array.isArray(safety.healthRecords) ? safety.healthRecords : [];
}

export function activeSignalKinds(state: Record<string, unknown>): string[] {
  const safety = sliceOf<{ activeSignals: { kind: string }[] }>(state, 'safety');
  return Array.isArray(safety.activeSignals) ? safety.activeSignals.map((s) => s.kind) : [];
}

/** Risco que impede qualquer estratégia com restrição energética. */
export function energyRestrictionBlocked(state: Record<string, unknown>): string | null {
  const kinds = activeSignalKinds(state);
  if (kinds.includes('EATING_DISORDER_SIGNS')) return 'sinais de transtorno alimentar';
  if (kinds.includes('PREGNANCY')) return 'gestação';
  const records = healthRecords(state);
  if (records.some((r) => r.kind === 'EATING_DISORDER_HISTORY'))
    return 'histórico de transtorno alimentar';
  if (records.some((r) => r.kind === 'PREGNANCY')) return 'gestação';
  return null;
}

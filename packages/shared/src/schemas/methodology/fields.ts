/**
 * Linguagem de descrição dos parâmetros de metodologia.
 *
 * Cada campo é descrito UMA vez com tudo o que o profissional precisa para preenchê-lo bem
 * (rótulo, dica, exemplo, unidade, faixa plausível e a referência que a sustenta). Da mesma
 * descrição saem a validação (`fieldSchema`) e o formulário do estúdio no painel — nunca
 * divergem.
 *
 * Faixa `min`/`max` é limite DURO (fora dela o valor é recusado). Faixa `plausible` é o que a
 * literatura e a prática sustentam: valor fora dela é aceito, mas exige justificativa escrita.
 */
import { z } from 'zod';

interface FieldBase {
  label: string;
  /** Como preencher bem — aparece ao lado do campo. */
  hint: string;
  /** Referência que sustenta a faixa plausível (diretriz, revisão, posicionamento). */
  reference?: string;
}

export type FieldSpec =
  | (FieldBase & {
      kind: 'number';
      unit?: string;
      min: number;
      max: number;
      step?: number;
      plausible?: readonly [number, number];
      example: number;
    })
  | (FieldBase & {
      kind: 'range';
      unit?: string;
      min: number;
      max: number;
      step?: number;
      plausible?: readonly [number, number];
      example: { min: number; max: number };
    })
  | (FieldBase & { kind: 'boolean'; example: boolean })
  | (FieldBase & {
      kind: 'choice';
      options: readonly { value: string; label: string }[];
      example: string;
    })
  | (FieldBase & {
      kind: 'multiChoice';
      options: readonly { value: string; label: string }[];
      example: readonly string[];
    })
  | (FieldBase & { kind: 'text'; maxLength: number; example: string })
  | (FieldBase & {
      kind: 'textList';
      maxItems: number;
      itemMaxLength: number;
      example: readonly string[];
    })
  | (FieldBase & {
      kind: 'table';
      /** Linhas fixas (ex.: níveis de experiência, objetivos, ações). */
      rows: readonly { key: string; label: string }[];
      /** Colunas fixas, cada uma com seu próprio campo. */
      columns: Readonly<Record<string, ColumnSpec>>;
    });

/** Coluna de tabela: um campo simples (sem tabela aninhada). */
export type ColumnSpec = Exclude<FieldSpec, { kind: 'table' | 'textList' | 'multiChoice' }>;

export interface SectionSpec {
  key: string;
  title: string;
  description: string;
  fields: Readonly<Record<string, FieldSpec>>;
}

export interface DomainSpec {
  domain: string;
  title: string;
  /** Para que serve o documento e quem o escreve. */
  description: string;
  /** Profissional responsável pela publicação (decide quem vê a fila de testes). */
  owner: 'CREF' | 'CRN' | 'CREF_CRN';
  sections: readonly SectionSpec[];
  /** Orientações em texto livre por tema (o "como pensar" que não cabe em número). */
  guidance: readonly { key: string; title: string; hint: string }[];
}

const rangeValue = (min: number, max: number) =>
  z
    .object({ min: z.number().min(min).max(max), max: z.number().min(min).max(max) })
    .refine((r) => r.min <= r.max, { message: 'O mínimo não pode ser maior que o máximo.' });

/** Schema Zod de UM campo (limites duros). */
export function fieldSchema(field: FieldSpec): z.ZodType {
  switch (field.kind) {
    case 'number':
      return z.number().min(field.min).max(field.max);
    case 'range':
      return rangeValue(field.min, field.max);
    case 'boolean':
      return z.boolean();
    case 'choice':
      return z.enum(field.options.map((o) => o.value) as [string, ...string[]]);
    case 'multiChoice':
      return z.array(z.enum(field.options.map((o) => o.value) as [string, ...string[]]));
    case 'text':
      return z.string().trim().min(1).max(field.maxLength);
    case 'textList':
      return z.array(z.string().trim().min(1).max(field.itemMaxLength)).max(field.maxItems);
    case 'table':
      return z.object(
        Object.fromEntries(
          field.rows.map((row) => [
            row.key,
            z.object(
              Object.fromEntries(
                Object.entries(field.columns).map(([key, column]) => [key, fieldSchema(column)]),
              ),
            ),
          ]),
        ),
      );
  }
}

/** Schema Zod de todos os parâmetros de um domínio: `{ <seção>: { <campo>: valor } }`. */
export function domainParametersSchema(spec: DomainSpec): z.ZodType<MethodologyParameters> {
  return z.object(
    Object.fromEntries(
      spec.sections.map((section) => [
        section.key,
        z.object(
          Object.fromEntries(
            Object.entries(section.fields).map(([key, field]) => [key, fieldSchema(field)]),
          ),
        ),
      ]),
    ),
  ) as unknown as z.ZodType<MethodologyParameters>;
}

export type MethodologyParameters = Record<string, Record<string, unknown>>;

/** Valores de exemplo de todos os campos (ponto de partida de um rascunho novo). */
export function exampleParameters(spec: DomainSpec): MethodologyParameters {
  const exampleOf = (field: FieldSpec): unknown => {
    if (field.kind !== 'table') return field.example;
    return Object.fromEntries(
      field.rows.map((row) => [
        row.key,
        Object.fromEntries(
          Object.entries(field.columns).map(([key, column]) => [key, exampleOf(column)]),
        ),
      ]),
    );
  };
  return Object.fromEntries(
    spec.sections.map((section) => [
      section.key,
      Object.fromEntries(
        Object.entries(section.fields).map(([key, field]) => [key, exampleOf(field)]),
      ),
    ]),
  );
}

/** Um valor fora da faixa plausível (aceito só com justificativa). */
export interface PlausibilityIssue {
  /** Caminho do campo (ex.: `volume.weeklySets.BEGINNER.sets`). */
  path: string;
  label: string;
  value: unknown;
  plausible: readonly [number, number];
}

function outside(value: unknown, plausible: readonly [number, number]): boolean {
  if (typeof value === 'number') return value < plausible[0] || value > plausible[1];
  if (value && typeof value === 'object' && 'min' in value && 'max' in value) {
    const range = value as { min: number; max: number };
    return range.min < plausible[0] || range.max > plausible[1];
  }
  return false;
}

/** Campos com valor fora da faixa plausível. */
export function plausibilityIssues(
  spec: DomainSpec,
  parameters: MethodologyParameters,
): PlausibilityIssue[] {
  const issues: PlausibilityIssue[] = [];
  const visit = (path: string, label: string, field: FieldSpec, value: unknown) => {
    if (field.kind === 'table') {
      for (const row of field.rows) {
        const rowValue = (value as Record<string, Record<string, unknown>> | undefined)?.[row.key];
        for (const [key, column] of Object.entries(field.columns)) {
          visit(`${path}.${row.key}.${key}`, `${label} — ${row.label}`, column, rowValue?.[key]);
        }
      }
      return;
    }
    if ((field.kind === 'number' || field.kind === 'range') && field.plausible) {
      if (outside(value, field.plausible)) {
        issues.push({ path, label, value, plausible: field.plausible });
      }
    }
  };
  for (const section of spec.sections) {
    for (const [key, field] of Object.entries(section.fields)) {
      visit(`${section.key}.${key}`, field.label, field, parameters[section.key]?.[key]);
    }
  }
  return issues;
}

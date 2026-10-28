/**
 * Cliente do estúdio de metodologia (painel → BFF → API `control-center/methodology`).
 * O servidor é a autoridade: limites, justificativas e o gate de testes são checados lá.
 */
import {
  methodologyChangeSchema,
  methodologyDocumentSchema,
  methodologyDomainSummarySchema,
  methodologyTestOutcomeSchema,
  methodologyVersionSummarySchema,
  type MethodologyChangeView,
  type MethodologyDocumentView,
  type MethodologyDomainSummary,
  type MethodologyParameters,
  type MethodologyTestOutcome,
  type MethodologyVersionSummary,
} from '@movivo/shared';

export type {
  MethodologyChangeView,
  MethodologyDocumentView,
  MethodologyDomainSummary,
  MethodologyTestOutcome,
  MethodologyVersionSummary,
};

export class MethodologyStudioError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'MethodologyStudioError';
  }
}

interface Parser<T> {
  parse(value: unknown): T;
}

const listOf = <T>(item: Parser<T>): Parser<T[]> => ({
  parse: (value) => {
    if (!Array.isArray(value)) throw new Error('lista esperada');
    return value.map((entry) => item.parse(entry));
  },
});

const BASE = '/api/dashboard/control/methodology';

async function call<T>(path: string, parser: Parser<T>, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers:
      body === undefined
        ? { Accept: 'application/json' }
        : { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = (await response.json().catch(() => null)) as {
    data?: unknown;
    message?: unknown;
    issues?: { path: string; message: string }[];
  } | null;
  if (!response.ok) {
    const message =
      typeof value?.message === 'string'
        ? value.message
        : response.status === 403
          ? 'Seu papel pode ver a metodologia, mas não editar nem publicar.'
          : 'Não foi possível concluir a operação.';
    throw new MethodologyStudioError(response.status, message, value?.issues ?? []);
  }
  try {
    return parser.parse(value?.data);
  } catch {
    throw new MethodologyStudioError(502, 'A resposta veio fora do contrato esperado.');
  }
}

export function listDomains(): Promise<MethodologyDomainSummary[]> {
  return call('domains', listOf(methodologyDomainSummarySchema));
}

export function getVersions(domain: string): Promise<MethodologyVersionSummary[]> {
  return call(`domains/${domain}`, {
    parse: (value) =>
      listOf(methodologyVersionSummarySchema).parse((value as { versions?: unknown })?.versions),
  });
}

export function openDraft(domain: string, fromVersion?: number): Promise<MethodologyDocumentView> {
  return call(
    `domains/${domain}/drafts`,
    methodologyDocumentSchema,
    fromVersion === undefined ? {} : { fromVersion },
  );
}

export function getDocument(
  id: string,
): Promise<{ document: MethodologyDocumentView; diff: MethodologyChangeView[] }> {
  return call(`documents/${id}`, {
    parse: (value) => {
      const record = value as { document?: unknown; diff?: unknown };
      return {
        document: methodologyDocumentSchema.parse(record?.document),
        diff: listOf(methodologyChangeSchema).parse(record?.diff),
      };
    },
  });
}

export function saveDraft(
  id: string,
  input: {
    parameters: MethodologyParameters;
    guidance: Record<string, string>;
    justifications: Record<string, string>;
    changeNote: string;
  },
): Promise<MethodologyDocumentView> {
  return call(`documents/${id}/update`, methodologyDocumentSchema, input);
}

export function testDraft(id: string): Promise<MethodologyTestOutcome> {
  return call(`documents/${id}/test`, methodologyTestOutcomeSchema, {});
}

export function publishDraft(id: string): Promise<MethodologyDocumentView> {
  return call(`documents/${id}/publish`, methodologyDocumentSchema, {});
}

export function discardDraft(id: string): Promise<{ discarded: boolean }> {
  return call(`documents/${id}/discard`, {
    parse: (value) => ({ discarded: (value as { discarded?: unknown })?.discarded === true }),
  });
}

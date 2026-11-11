/**
 * Cliente do estúdio de metodologia (painel → BFF → API `control-center/methodology`).
 * O servidor é a autoridade: limites, justificativas e o gate de testes são checados lá.
 */
import {
  methodologyChangeSchema,
  methodologyDocumentSchema,
  methodologyDomainSummarySchema,
  methodologyTestEstimateSchema,
  methodologyTestProgressSchema,
  methodologyVersionSummarySchema,
  type MethodologyChangeView,
  type MethodologyDocumentView,
  type MethodologyDomainSummary,
  type MethodologyParameters,
  type MethodologyTestEstimate,
  type MethodologyTestOutcome,
  type MethodologyTestProgress,
  type MethodologyVersionSummary,
} from '@movivo/shared';

import { friendlyMessage } from './api-message';

export type {
  MethodologyChangeView,
  MethodologyDocumentView,
  MethodologyDomainSummary,
  MethodologyTestEstimate,
  MethodologyTestOutcome,
  MethodologyTestProgress,
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

/** Textos próprios do estúdio, mais úteis que os genéricos para estes dois casos. */
const STUDIO_STATUS_MESSAGE: Readonly<Record<number, string>> = {
  403: 'Seu papel pode ver a metodologia, mas não editar nem publicar.',
  409: 'Esta ação não é possível no estado atual da versão. Atualize a página e confira.',
};

function messageOf(status: number, raw: unknown): string {
  return friendlyMessage(status, raw, STUDIO_STATUS_MESSAGE[status]);
}

async function call<T>(path: string, parser: Parser<T>, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers:
        body === undefined
          ? { Accept: 'application/json' }
          : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new MethodologyStudioError(
      0,
      'Não foi possível conectar ao servidor. Confira sua internet e tente de novo.',
    );
  }
  const value = (await response.json().catch(() => null)) as {
    data?: unknown;
    message?: unknown;
    issues?: { path: string; message: string }[];
  } | null;
  if (!response.ok) {
    throw new MethodologyStudioError(
      response.status,
      messageOf(response.status, value?.message),
      value?.issues ?? [],
    );
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

const TEST_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_POLL_FAILURES = 3;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface MethodologyTestResult {
  outcome: MethodologyTestOutcome;
  /** Quanto o teste gastou com modelos de IA (R$). */
  spentBrl: number;
  /** Por que parou antes de avaliar tudo, quando foi o caso. */
  stoppedReason: string | null;
}

/** Quanto o teste deve custar, calculado SEM chamar nenhum modelo. */
export function getTestEstimate(id: string): Promise<MethodologyTestEstimate> {
  return call(`documents/${id}/test/estimate`, methodologyTestEstimateSchema);
}

/** Pede para parar antes da próxima tarefa (a que está rodando termina). */
export function cancelTest(id: string): Promise<MethodologyTestProgress> {
  return call(`documents/${id}/test/cancel`, methodologyTestProgressSchema, {});
}

/**
 * Testa o rascunho com os agentes. O servidor roda o teste em segundo plano (leva minutos, com
 * modelos reais); aqui iniciamos, com o limite de gasto confirmado, e consultamos o andamento
 * até terminar.
 */
export async function testDraft(
  id: string,
  budgetBrl: number,
  onProgress?: (progress: MethodologyTestProgress) => void,
  pollMs = 3000,
): Promise<MethodologyTestResult> {
  let progress = await call(`documents/${id}/test`, methodologyTestProgressSchema, { budgetBrl });
  const startedAt = Date.now();
  let failures = 0;
  for (;;) {
    onProgress?.(progress);
    if (progress.state === 'FINISHED' && progress.outcome) {
      return {
        outcome: progress.outcome,
        spentBrl: progress.spentBrl,
        stoppedReason: progress.stoppedReason,
      };
    }
    if (progress.state === 'FAILED') {
      throw new MethodologyStudioError(
        502,
        progress.error ?? 'Não foi possível concluir o teste. Tente de novo em instantes.',
      );
    }
    if (progress.state === 'IDLE') {
      throw new MethodologyStudioError(
        409,
        'O teste foi interrompido (o servidor reiniciou). Clique em Testar com os agentes de novo.',
      );
    }
    if (Date.now() - startedAt > TEST_TIMEOUT_MS) {
      throw new MethodologyStudioError(
        504,
        'O teste está demorando mais que o normal. Atualize a página para ver se ele terminou.',
      );
    }
    await wait(pollMs);
    try {
      progress = await call(`documents/${id}/test`, methodologyTestProgressSchema);
      failures = 0;
    } catch (error) {
      // Uma oscilação de rede não deve derrubar um teste de vários minutos.
      failures += 1;
      if (failures >= MAX_POLL_FAILURES) throw error;
    }
  }
}

export function publishDraft(id: string): Promise<MethodologyDocumentView> {
  return call(`documents/${id}/publish`, methodologyDocumentSchema, {});
}

export function discardDraft(id: string): Promise<{ discarded: boolean }> {
  return call(
    `documents/${id}/discard`,
    {
      parse: (value) => ({ discarded: (value as { discarded?: unknown })?.discarded === true }),
    },
    {},
  );
}

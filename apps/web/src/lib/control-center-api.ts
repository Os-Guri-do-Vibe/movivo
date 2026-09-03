import {
  agentConfigHistoryResponseSchema,
  auditSearchResponseSchema,
  agentPersonaResponseSchema,
  configSimulationResponseSchema,
  exerciseCatalogResponseSchema,
  type ExerciseCatalogResponse,
  type PublishExerciseCatalogEntryInput,
  type RetireExerciseCatalogEntryInput,
  faqEntriesResponseSchema,
  forbiddenTopicsResponseSchema,
  inviolableRulesResponseSchema,
  type CreateForbiddenTopicInput,
  type ForbiddenTopicActionInput,
  type ForbiddenTopicsResponse,
  l1GuardrailsResponseSchema,
  type AgentConfigHistoryResponse,
  type AuditSearchQuery,
  type AuditSearchResponse,
  type BiologicalSex,
  type AgentPersonaResponse,
  type ConfigSimulationResponse,
  type FaqEntriesResponse,
  type InviolableRulesResponse,
  type L1GuardrailsResponse,
  knowledgeDocumentsResponseSchema,
  knowledgeDocumentContentResponseSchema,
  type KnowledgeDocumentContentResponse,
  type KnowledgeDocumentsResponse,
  type ReviewKnowledgeDocumentInput,
  type UploadKnowledgeDocumentInput,
  type PublishAgentConfigInput,
  type PublishFaqEntryInput,
  type PublishL1GuardrailInput,
  type RollbackAgentConfigInput,
  type RollbackFaqEntryInput,
  type RetireFaqEntryInput,
  type RetireL1GuardrailInput,
  type RollbackL1GuardrailInput,
  type SimulateAgentConfigInput,
  controlCenterComplianceResponseSchema,
  controlCenterFinanceResponseSchema,
  controlCenterMarketingResponseSchema,
  controlCenterOverviewResponseSchema,
  controlCenterStudentDetailResponseSchema,
  controlCenterStudentsResponseSchema,
  controlCenterSystemResponseSchema,
  type ControlCenterComplianceResponse,
  controlCenterCampaignsResponseSchema,
  type ControlCenterCampaignsResponse,
  type ControlCenterFinanceResponse,
  type ControlCenterMarketingResponse,
  type ControlCenterOverviewResponse,
  type ControlCenterStudentDetailResponse,
  type ControlCenterStudentsResponse,
  type ControlCenterSystemResponse,
  partnerDistributionResponseSchema,
  type PartnerDistributionResponse,
  controlCenterIntegrationResponseSchema,
  type ControlCenterIntegrationResponse,
  type CreateWhatsappInstanceInput,
} from '@movivo/shared';

interface Parser<T> {
  parse(value: unknown): T;
}

export type KnowledgeDocumentStatus =
  | 'QUARANTINED'
  | 'QUEUED'
  | 'PROCESSING'
  | 'READY_FOR_REVIEW'
  | 'APPROVED'
  | 'INDEXING'
  | 'PUBLISHED'
  | 'REJECTED'
  | 'FAILED'
  | 'ARCHIVED'
  | 'PENDING';

export interface KnowledgeDocumentView {
  id: string;
  title: string;
  topic: string;
  sourceUrl: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  status: KnowledgeDocumentStatus;
  uploadedBy: string | null;
  reviewer: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  retainedUntil: string | null;
  blobAvailable: boolean;
  chunkCount: number;
  category?: string | null;
  logicalKey?: string | null;
  version?: number | string | null;
  author?: string | null;
  license?: string | null;
  stage?: string | null;
  errorCode?: string | null;
  canRetry?: boolean;
  processingStage?: string | null;
  processingError?: string | null;
  statusUpdatedAt?: string | null;
}

export interface KnowledgeDocumentsViewResponse extends Omit<KnowledgeDocumentsResponse, 'data'> {
  data: Omit<KnowledgeDocumentsResponse['data'], 'documents'> & {
    documents: KnowledgeDocumentView[];
  };
}

export type MethodologyStatus =
  'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'PUBLISHED' | 'REJECTED' | 'ARCHIVED';

export interface MethodologyVersionView {
  id: string;
  version: number | string;
  status: MethodologyStatus;
  content: string;
  sha256: string | null;
  changeNote: string | null;
  createdBy: string | null;
  reviewedBy: string | null;
  createdAt: string;
  reviewedAt: string | null;
  publishedAt: string | null;
  statusChangedAt: string | null;
  current: boolean;
}

export interface MethodologyResponse {
  data: {
    versions: MethodologyVersionView[];
  };
  meta: KnowledgeDocumentsResponse['meta'];
}

export class ControlCenterApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const KNOWLEDGE_STATUSES = new Set<KnowledgeDocumentStatus>([
  'QUARANTINED',
  'QUEUED',
  'PROCESSING',
  'READY_FOR_REVIEW',
  'APPROVED',
  'INDEXING',
  'PUBLISHED',
  'REJECTED',
  'FAILED',
  'ARCHIVED',
  'PENDING',
]);
const METHODOLOGY_STATUSES = new Set<MethodologyStatus>([
  'DRAFT',
  'IN_REVIEW',
  'APPROVED',
  'PUBLISHED',
  'REJECTED',
  'ARCHIVED',
]);

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** Aceita o contrato legado e a evolução assíncrona sem afrouxar campos essenciais. */
const knowledgeDocumentsViewResponseSchema: Parser<KnowledgeDocumentsViewResponse> = {
  parse(value) {
    const strict = knowledgeDocumentsResponseSchema.safeParse(value);
    if (strict.success) {
      const documents = strict.data.data.documents.map((entry) => ({
        ...entry,
        processingStage: optionalString(entry.stage),
        processingError: optionalString(entry.errorCode),
      })) as unknown as KnowledgeDocumentView[];
      return {
        ...strict.data,
        data: { ...strict.data.data, documents },
      } as unknown as KnowledgeDocumentsViewResponse;
    }
    if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.documents)) {
      throw new Error('Resposta de documentos inválida.');
    }
    const documents = value.data.documents.map((entry) => {
      if (
        !isRecord(entry) ||
        typeof entry.status !== 'string' ||
        !KNOWLEDGE_STATUSES.has(entry.status as KnowledgeDocumentStatus)
      ) {
        throw new Error('Documento inválido.');
      }
      const requiredStrings = [
        'id',
        'title',
        'topic',
        'originalFilename',
        'mimeType',
        'sha256',
        'createdAt',
      ] as const;
      if (requiredStrings.some((key) => typeof entry[key] !== 'string')) {
        throw new Error('Documento incompleto.');
      }
      return {
        ...entry,
        processingStage: optionalString(entry.processingStage ?? entry.stage),
        processingError: optionalString(entry.processingError ?? entry.errorCode),
      } as unknown as KnowledgeDocumentView;
    });
    const base = value as unknown as KnowledgeDocumentsViewResponse;
    return { ...base, data: { ...base.data, documents } };
  },
};

const methodologyResponseSchema: Parser<MethodologyResponse> = {
  parse(value) {
    if (
      !isRecord(value) ||
      !isRecord(value.data) ||
      !Array.isArray(value.data.versions) ||
      !isRecord(value.meta)
    ) {
      throw new Error('Resposta de metodologia inválida.');
    }
    const currentId = optionalString(value.data.currentVersionId);
    const versions = value.data.versions.map((entry) => {
      if (
        !isRecord(entry) ||
        typeof entry.id !== 'string' ||
        (typeof (entry.version ?? entry.versionLabel) !== 'number' &&
          typeof (entry.version ?? entry.versionLabel) !== 'string') ||
        typeof entry.status !== 'string' ||
        !METHODOLOGY_STATUSES.has(entry.status as MethodologyStatus) ||
        typeof entry.content !== 'string' ||
        typeof (entry.createdAt ?? entry.statusChangedAt) !== 'string'
      ) {
        throw new Error('Versão de metodologia inválida.');
      }
      const status = entry.status as MethodologyStatus;
      const statusChangedAt = optionalString(entry.statusChangedAt);
      return {
        id: entry.id,
        version: (entry.version ?? entry.versionLabel) as number | string,
        status,
        content: entry.content,
        sha256: optionalString(entry.sha256 ?? entry.contentHash ?? entry.contentSha256),
        changeNote: optionalString(entry.changeNote),
        createdBy: optionalString(entry.createdBy ?? entry.createdByName),
        reviewedBy: optionalString(entry.reviewedBy ?? entry.reviewedByName ?? entry.lastActor),
        createdAt: (entry.createdAt ?? entry.statusChangedAt) as string,
        reviewedAt:
          optionalString(entry.reviewedAt) ??
          (status === 'APPROVED' || status === 'REJECTED' ? statusChangedAt : null),
        publishedAt:
          optionalString(entry.publishedAt) ?? (status === 'PUBLISHED' ? statusChangedAt : null),
        statusChangedAt,
        current:
          entry.current === true ||
          entry.isCurrent === true ||
          (currentId !== null && entry.id === currentId),
      };
    });
    return {
      data: { versions },
      meta: value.meta as unknown as MethodologyResponse['meta'],
    };
  },
};

async function request<T>(path: string, schema: Parser<T>, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/dashboard/control/${path}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal,
  });
  const value = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      isRecord(value) && typeof value.message === 'string'
        ? value.message
        : response.status === 403
          ? 'Seu papel não pode acessar este setor.'
          : 'Não foi possível carregar este setor.';
    throw new ControlCenterApiError(response.status, message);
  }
  try {
    return schema.parse(value);
  } catch {
    throw new ControlCenterApiError(502, 'O setor devolveu dados fora do contrato esperado.');
  }
}

export const parseControlCenterOverview = (value: unknown) =>
  controlCenterOverviewResponseSchema.parse(value);
export const parseControlCenterMarketing = (value: unknown) =>
  controlCenterMarketingResponseSchema.parse(value);
export const parseControlCenterStudents = (value: unknown) =>
  controlCenterStudentsResponseSchema.parse(value);
export const parseControlCenterStudent = (value: unknown) =>
  controlCenterStudentDetailResponseSchema.parse(value);
export const parseControlCenterSystem = (value: unknown) =>
  controlCenterSystemResponseSchema.parse(value);
export const parseControlCenterFinance = (value: unknown) =>
  controlCenterFinanceResponseSchema.parse(value);
export const parseControlCenterCompliance = (value: unknown) =>
  controlCenterComplianceResponseSchema.parse(value);

export function getOverview(signal?: AbortSignal): Promise<ControlCenterOverviewResponse> {
  return request('overview', controlCenterOverviewResponseSchema, signal);
}

export function getMarketing(signal?: AbortSignal): Promise<ControlCenterMarketingResponse> {
  return request('marketing', controlCenterMarketingResponseSchema, signal);
}

export function getCampaigns(signal?: AbortSignal): Promise<ControlCenterCampaignsResponse> {
  return request('campaigns', controlCenterCampaignsResponseSchema, signal);
}

export function getStudents(signal?: AbortSignal): Promise<ControlCenterStudentsResponse> {
  return request('students', controlCenterStudentsResponseSchema, signal);
}

export function getStudent(
  id: string,
  signal?: AbortSignal,
): Promise<ControlCenterStudentDetailResponse> {
  return request(
    `students/${encodeURIComponent(id)}`,
    controlCenterStudentDetailResponseSchema,
    signal,
  );
}

export function getSystemSummary(signal?: AbortSignal): Promise<ControlCenterSystemResponse> {
  return request('system', controlCenterSystemResponseSchema, signal);
}

export function getFinanceSummary(signal?: AbortSignal): Promise<ControlCenterFinanceResponse> {
  return request('finance', controlCenterFinanceResponseSchema, signal);
}

export function getComplianceSummary(
  signal?: AbortSignal,
): Promise<ControlCenterComplianceResponse> {
  return request('compliance', controlCenterComplianceResponseSchema, signal);
}

export function getAuditEvents(
  query: AuditSearchQuery,
  signal?: AbortSignal,
): Promise<AuditSearchResponse> {
  const params = new URLSearchParams();
  if (query.actorId) params.set('actorId', query.actorId);
  if (query.action) params.set('action', query.action);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  params.set('page', String(query.page));
  params.set('pageSize', String(query.pageSize));
  return request(`audit?${params.toString()}`, auditSearchResponseSchema, signal);
}

/* --------------------------------- Pilar IA (US-7.7) --------------------------------- */

/**
 * Leituras do pilar IA. Todas são escopadas a um slot de persona (`targetSex`): existem duas
 * personas publicadas ao mesmo tempo, uma por público, cada uma com histórico e numeração de
 * versão próprios. O slot vai em **query param** porque a API o exige assim — `persona/:sex`
 * colidiria com a rota `persona/history` no roteador do Nest.
 */
function slotQuery(targetSex: BiologicalSex): string {
  return `?${new URLSearchParams({ targetSex }).toString()}`;
}

export function getAgentPersona(
  targetSex: BiologicalSex,
  signal?: AbortSignal,
): Promise<AgentPersonaResponse> {
  return request(`ai/persona${slotQuery(targetSex)}`, agentPersonaResponseSchema, signal);
}

export function getAgentConfigHistory(
  targetSex: BiologicalSex,
  signal?: AbortSignal,
): Promise<AgentConfigHistoryResponse> {
  return request(
    `ai/persona/history${slotQuery(targetSex)}`,
    agentConfigHistoryResponseSchema,
    signal,
  );
}

export function getInviolableRules(
  targetSex: BiologicalSex,
  signal?: AbortSignal,
): Promise<InviolableRulesResponse> {
  return request(
    `ai/inviolable-rules${slotQuery(targetSex)}`,
    inviolableRulesResponseSchema,
    signal,
  );
}

/**
 * Mutações do pilar IA. O servidor é a autoridade: a validação client-side existe para dar
 * erro cedo, e a capability `AI_CONFIG_WRITE` é exigida no endpoint — esconder o botão na UI
 * nunca foi o controle de acesso.
 */
async function mutate<T>(path: string, body: unknown, schema: Parser<T>): Promise<T> {
  const response = await fetch(`/api/dashboard/control/${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const value = (await response.json().catch(() => null)) as unknown;
  if (!response.ok) {
    const message =
      isRecord(value) && typeof value.message === 'string'
        ? value.message
        : response.status === 403
          ? 'Seu papel pode ver a configuração, mas não publicar.'
          : 'Não foi possível concluir a publicação.';
    throw new ControlCenterApiError(response.status, message);
  }
  try {
    return schema.parse(value);
  } catch {
    throw new ControlCenterApiError(502, 'A publicação devolveu dados fora do contrato esperado.');
  }
}

export function publishAgentPersona(input: PublishAgentConfigInput): Promise<AgentPersonaResponse> {
  return mutate('ai/persona', input, agentPersonaResponseSchema);
}

export function rollbackAgentPersona(
  input: RollbackAgentConfigInput,
): Promise<AgentPersonaResponse> {
  return mutate('ai/persona/rollback', input, agentPersonaResponseSchema);
}

export function simulateAgentConfig(
  input: SimulateAgentConfigInput,
): Promise<ConfigSimulationResponse> {
  return mutate('ai/simulate', input, configSimulationResponseSchema);
}

export function getFaqEntries(signal?: AbortSignal): Promise<FaqEntriesResponse> {
  return request('ai/faq', faqEntriesResponseSchema, signal);
}

export function publishFaqEntry(input: PublishFaqEntryInput): Promise<FaqEntriesResponse> {
  return mutate('ai/faq', input, faqEntriesResponseSchema);
}

export function rollbackFaqEntry(input: RollbackFaqEntryInput): Promise<FaqEntriesResponse> {
  return mutate('ai/faq/rollback', input, faqEntriesResponseSchema);
}

export function retireFaqEntry(input: RetireFaqEntryInput): Promise<FaqEntriesResponse> {
  return mutate('ai/faq/retire', input, faqEntriesResponseSchema);
}

export function getExerciseCatalog(signal?: AbortSignal): Promise<ExerciseCatalogResponse> {
  return request('ai/exercise-catalog', exerciseCatalogResponseSchema, signal);
}

export function publishExerciseCatalogEntry(
  input: PublishExerciseCatalogEntryInput,
): Promise<ExerciseCatalogResponse> {
  return mutate('ai/exercise-catalog', input, exerciseCatalogResponseSchema);
}

export function retireExerciseCatalogEntry(
  input: RetireExerciseCatalogEntryInput,
): Promise<ExerciseCatalogResponse> {
  return mutate('ai/exercise-catalog/retire', input, exerciseCatalogResponseSchema);
}

export function getL1Guardrails(signal?: AbortSignal): Promise<L1GuardrailsResponse> {
  return request('ai/guardrails', l1GuardrailsResponseSchema, signal);
}

export function publishL1Guardrail(input: PublishL1GuardrailInput): Promise<L1GuardrailsResponse> {
  return mutate('ai/guardrails', input, l1GuardrailsResponseSchema);
}

export function rollbackL1Guardrail(
  input: RollbackL1GuardrailInput,
): Promise<L1GuardrailsResponse> {
  return mutate('ai/guardrails/rollback', input, l1GuardrailsResponseSchema);
}

export function retireL1Guardrail(input: RetireL1GuardrailInput): Promise<L1GuardrailsResponse> {
  return mutate('ai/guardrails/retire', input, l1GuardrailsResponseSchema);
}

/* ------------------------- Temas proibidos (workflow auditável) ------------------------- */

/**
 * Temas proibidos são entidade própria, **não** um campo da persona: o contrato
 * (`forbidden-topic.schema.ts`) separa `label` — que vai ao prompt — de `phrases`, que
 * nunca sai do comparador determinístico do servidor. Por isso a publicação também é
 * separada: propor exige `AI_CONFIG_WRITE` e aprovar exige `AI_GUARDRAIL_APPROVE`.
 * `PROFESSIONAL` segue maker-checker; `ADMIN` pode executar todas as transições.
 */
export function getForbiddenTopics(signal?: AbortSignal): Promise<ForbiddenTopicsResponse> {
  return request('ai/forbidden-topics', forbiddenTopicsResponseSchema, signal);
}

export function proposeForbiddenTopic(
  input: CreateForbiddenTopicInput,
): Promise<ForbiddenTopicsResponse> {
  return mutate('ai/forbidden-topics', input, forbiddenTopicsResponseSchema);
}

export function submitForbiddenTopic(
  input: ForbiddenTopicActionInput,
): Promise<ForbiddenTopicsResponse> {
  return mutate('ai/forbidden-topics/submit', input, forbiddenTopicsResponseSchema);
}

export function approveForbiddenTopic(
  input: ForbiddenTopicActionInput,
): Promise<ForbiddenTopicsResponse> {
  return mutate('ai/forbidden-topics/approve', input, forbiddenTopicsResponseSchema);
}

export function retireForbiddenTopic(
  input: ForbiddenTopicActionInput,
): Promise<ForbiddenTopicsResponse> {
  return mutate('ai/forbidden-topics/retire', input, forbiddenTopicsResponseSchema);
}

export function getKnowledgeDocuments(
  signal?: AbortSignal,
): Promise<KnowledgeDocumentsViewResponse> {
  return request('ai/knowledge', knowledgeDocumentsViewResponseSchema, signal);
}

export function getKnowledgeDocumentContent(
  id: string,
  signal?: AbortSignal,
): Promise<KnowledgeDocumentContentResponse> {
  return request(
    `ai/knowledge/${encodeURIComponent(id)}/content`,
    knowledgeDocumentContentResponseSchema,
    signal,
  );
}

export function uploadKnowledgeDocument(
  input: UploadKnowledgeDocumentInput,
): Promise<KnowledgeDocumentsViewResponse> {
  return mutate('ai/knowledge/upload', input, knowledgeDocumentsViewResponseSchema);
}

export function reviewKnowledgeDocument(
  input: ReviewKnowledgeDocumentInput,
): Promise<KnowledgeDocumentsViewResponse> {
  return mutate('ai/knowledge/review', input, knowledgeDocumentsViewResponseSchema);
}

export function retryKnowledgeDocument(id: string): Promise<KnowledgeDocumentsViewResponse> {
  return mutate(
    `ai/knowledge/${encodeURIComponent(id)}/retry`,
    {},
    knowledgeDocumentsViewResponseSchema,
  );
}

export function archiveKnowledgeDocument(
  id: string,
  note: string,
): Promise<KnowledgeDocumentsViewResponse> {
  return mutate(
    `ai/knowledge/${encodeURIComponent(id)}/archive`,
    { note },
    knowledgeDocumentsViewResponseSchema,
  );
}

export function getMethodology(signal?: AbortSignal): Promise<MethodologyResponse> {
  return request('ai/methodology', methodologyResponseSchema, signal);
}

export function createMethodologyVersion(input: {
  content: string;
  changeNote: string;
}): Promise<MethodologyResponse> {
  return mutate('ai/methodology', input, methodologyResponseSchema);
}

export function submitMethodologyVersion(id: string, note: string): Promise<MethodologyResponse> {
  return mutate(
    `ai/methodology/${encodeURIComponent(id)}/submit`,
    { note },
    methodologyResponseSchema,
  );
}

export function reviewMethodologyVersion(
  id: string,
  input: { decision: 'APPROVED' | 'REJECTED'; note: string },
): Promise<MethodologyResponse> {
  return mutate(
    `ai/methodology/${encodeURIComponent(id)}/review`,
    input,
    methodologyResponseSchema,
  );
}

export function publishMethodologyVersion(id: string, note: string): Promise<MethodologyResponse> {
  return mutate(
    `ai/methodology/${encodeURIComponent(id)}/publish`,
    { note },
    methodologyResponseSchema,
  );
}

export function rollbackMethodologyVersion(id: string, note: string): Promise<MethodologyResponse> {
  return mutate(
    `ai/methodology/${encodeURIComponent(id)}/rollback`,
    { note },
    methodologyResponseSchema,
  );
}

/* ------------------------- Sócios & Distribuição (US-8.7) ------------------------- */

export function getPartnerDistribution(signal?: AbortSignal): Promise<PartnerDistributionResponse> {
  return request('partners', partnerDistributionResponseSchema, signal);
}

/* --------- Sistema → Integração (EvolutionAPI, ferramenta INTERNA de teste) -------- */

export function getIntegration(signal?: AbortSignal): Promise<ControlCenterIntegrationResponse> {
  return request('integration', controlCenterIntegrationResponseSchema, signal);
}

export function createWhatsappInstance(
  input: CreateWhatsappInstanceInput,
): Promise<ControlCenterIntegrationResponse> {
  return mutate('integration/whatsapp/instance', input, controlCenterIntegrationResponseSchema);
}

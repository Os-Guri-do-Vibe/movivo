import {
  agentConfigHistoryResponseSchema,
  auditSearchResponseSchema,
  agentPersonaResponseSchema,
  configSimulationResponseSchema,
  faqEntriesResponseSchema,
  inviolableRulesResponseSchema,
  l1GuardrailsResponseSchema,
  type AgentConfigHistoryResponse,
  type AuditSearchQuery,
  type AuditSearchResponse,
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

export function getAgentPersona(signal?: AbortSignal): Promise<AgentPersonaResponse> {
  return request('ai/persona', agentPersonaResponseSchema, signal);
}

export function getAgentConfigHistory(signal?: AbortSignal): Promise<AgentConfigHistoryResponse> {
  return request('ai/persona/history', agentConfigHistoryResponseSchema, signal);
}

export function getInviolableRules(signal?: AbortSignal): Promise<InviolableRulesResponse> {
  return request('ai/inviolable-rules', inviolableRulesResponseSchema, signal);
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

export function getKnowledgeDocuments(signal?: AbortSignal): Promise<KnowledgeDocumentsResponse> {
  return request('ai/knowledge', knowledgeDocumentsResponseSchema, signal);
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
): Promise<KnowledgeDocumentsResponse> {
  return mutate('ai/knowledge/upload', input, knowledgeDocumentsResponseSchema);
}

export function reviewKnowledgeDocument(
  input: ReviewKnowledgeDocumentInput,
): Promise<KnowledgeDocumentsResponse> {
  return mutate('ai/knowledge/review', input, knowledgeDocumentsResponseSchema);
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
